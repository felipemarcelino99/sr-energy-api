import multipart from '@fastify/multipart'
import { buildApp, mockSupabase } from '../helpers/build-app'
import machinesRoute from '@/routes/machines'
import * as overviewService from '@/services/rag.overview.service'

jest.mock('@/services/rag.overview.service')

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => jest.clearAllMocks())

describe('GET /machines', () => {
  it('retorna lista', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const rows = [{ id: 'm-1', name: 'TR-500' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /machines/:id/jobs', () => {
  it('retorna histórico de trabalhos da máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const jobs = [{ id: 'j-1', employee_name: 'João', scheduled_date: '2026-03-10' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: jobs, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(jobs)
  })
})

describe('GET /machines/:id/tools', () => {
  it('retorna ferramentas da máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const rows = [{ id: 'mt-1', machine_id: 'm-1', tool_id: 't-1', quantity_required: 1, tools: { id: 't-1', name: 'Multímetro' } }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1/tools', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('POST /machines/:id/tools', () => {
  it('manager associa ferramenta à máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const toolId = 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd'
    const row = { id: 'mt-1', machine_id: 'm-1', tool_id: toolId, quantity_required: 2, tools: { id: toolId, name: 'Multímetro' } }
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST', url: '/machines/m-1/tools',
      headers: { 'x-test-user': mgr },
      payload: { tool_id: toolId, quantity_required: 2 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().quantity_required).toBe(2)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/machines/m-1/tools', headers: { 'x-test-user': emp },
      payload: { tool_id: 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /machines/:id/tools/:toolId', () => {
  it('manager remove associação', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1/tools/t-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)
  })
})

describe('GET /machines/:id/overview', () => {
  it('returns cached overview', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    jest.mocked(overviewService.getOrGenerateOverview).mockResolvedValue('Overview da máquina.')
    const res = await app.inject({ method: 'GET', url: '/machines/machine-1/overview', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
    expect(res.json().overview).toBe('Overview da máquina.')
  })

  it('returns 404 when manual is not indexed', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    jest.mocked(overviewService.getOrGenerateOverview).mockRejectedValue(
      new Error('Manual não indexado para esta máquina')
    )
    const res = await app.inject({ method: 'GET', url: '/machines/machine-1/overview', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /machines/:id/manual — admin guard', () => {
  it('returns 403 for employee role', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/machines/machine-1/manual',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /machines/:id', () => {
  it('retorna máquina por id', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'm-1' }, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando não encontrada', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-9', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })
})

const validMachineBody = {
  name: 'TR-500', brand: 'ACME', model: 'X1', serial_number: 'SN-1', year: 2024,
}

describe('POST /machines', () => {
  it('cria máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'm-1', ...validMachineBody }, error: null }) }) }),
    })
    const res = await app.inject({ method: 'POST', url: '/machines', headers: { 'x-test-user': mgr }, payload: validMachineBody })
    expect(res.statusCode).toBe(201)
  })

  it('retorna 400 com body inválido', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/machines', headers: { 'x-test-user': mgr }, payload: { name: 'a' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /machines/:id', () => {
  it('atualiza máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'm-1', ...validMachineBody }, error: null }) }) }) }),
    })
    const res = await app.inject({ method: 'PUT', url: '/machines/m-1', headers: { 'x-test-user': mgr }, payload: validMachineBody })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando máquina não existe', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }) }),
    })
    const res = await app.inject({ method: 'PUT', url: '/machines/m-9', headers: { 'x-test-user': mgr }, payload: validMachineBody })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /machines/:id', () => {
  it('remove máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)
  })
})

describe('DELETE /machines/:id/tools/:toolId — role guard', () => {
  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1/tools/t-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /machines/:id/documents', () => {
  it('retorna documentos da máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [{ id: 'd-1' }], error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1/documents', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('POST /machines/:id/manual', () => {
  it('faz upload do manual, indexa em background e retorna 201', async () => {
    const app = buildApp()
    await app.register(multipart)
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()

    jest.mocked(overviewService.getOrGenerateOverview).mockResolvedValue('n/a')
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://public/manual.pdf' } }),
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'machine_documents') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }) }),
        insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }) }) }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/m-1/manual',
      headers: { 'x-test-user': mgr, 'content-type': 'multipart/form-data; boundary=----b1' },
      payload: Buffer.from(
        '------b1\r\nContent-Disposition: form-data; name="file"; filename="manual.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 fake\r\n------b1--\r\n',
      ),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('doc-1')
  })

  it('retorna 409 quando o mesmo PDF (hash) já foi enviado', async () => {
    const app = buildApp()
    await app.register(multipart)
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'machine_documents') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'doc-dup' }, error: null }) }) }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST',
      url: '/machines/m-1/manual',
      headers: { 'x-test-user': mgr, 'content-type': 'multipart/form-data; boundary=----b1' },
      payload: Buffer.from(
        '------b1\r\nContent-Disposition: form-data; name="file"; filename="manual.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 fake\r\n------b1--\r\n',
      ),
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('DELETE /machines/:id/documents/:docId', () => {
  it('remove documento e arquivo do storage', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.storage.from.mockReturnValue({ remove: jest.fn().mockResolvedValue({ error: null }) })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }) }) }) }),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1/documents/doc-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 quando documento não existe', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    })
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1/documents/doc-9', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: '/machines/m-1/documents/doc-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /machines/:id/overview — erro genérico', () => {
  it('retorna 502 quando o serviço falha por outro motivo', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    jest.mocked(overviewService.getOrGenerateOverview).mockRejectedValue(new Error('Groq indisponível'))
    const res = await app.inject({ method: 'GET', url: '/machines/machine-1/overview', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(502)
  })
})
