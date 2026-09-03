import { buildApp, mockSupabase } from '../helpers/build-app'
import reportsRoute from '@/routes/reports'
import multipart from '@fastify/multipart'

function buildMultipartPayload(fieldName: string, filename: string, mimetype: string, content: Buffer) {
  const boundary = '----testBoundary123456'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([head, content, tail]),
  }
}

const emp = JSON.stringify({ id: 'emp-user-1', role: 'employee', name: 'João', email: 'j@sr.com' })
const admin = JSON.stringify({ id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })

beforeEach(() => jest.clearAllMocks())

describe('GET /jobs/:id/report', () => {
  it('retorna relatório do job', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'rpt-1' }, error: null }) }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs/j-1/report', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando não há relatório', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }) }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs/j-1/report', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /jobs/:id/report', () => {
  it('cria relatório e muda status do job para completed', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    // Mock: buscar employee pelo user_id + confirmar ownership do job
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: 'emp-db-1' }, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }
      if (table === 'job_reports') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'rpt-1', job_id: 'j-1', content: '<p>ok</p>' }, error: null }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST', url: '/jobs/j-1/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Relatório ok</p>' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('rpt-1')
  })

  it('CRITICAL-02 (IDOR): employee recebe 404 ao criar relatório de job alheio', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'j-9', employee_id: 'emp-outro' }, error: null }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST', url: '/jobs/j-9/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Relatório forjado</p>' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('admin cria relatório sem checagem de ownership (bypass)', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      }
      if (table === 'job_reports') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'rpt-2', job_id: 'j-1' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST', url: '/jobs/j-1/report',
      headers: { 'x-test-user': admin, 'content-type': 'application/json' },
      payload: { content: '<p>Relatório admin</p>' },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('POST /jobs/:id/report — assertJobOwnership branches', () => {
  it('retorna 403 quando employee não tem registro (user_id não encontrado)', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'POST', url: '/jobs/j-1/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>x</p>' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 quando job não existe', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }),
        }),
      }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'POST', url: '/jobs/j-999/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>x</p>' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /reports/:id/evidences', () => {
  it('CRITICAL-05: aceita PDF com magic bytes válidos', async () => {
    const app = buildApp()
    app.register(multipart)
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'ev-1' }, error: null }) }),
      }),
    })
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/ev.pdf' }, error: null }),
    })
    const pdfBytes = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.from('-1.4 fake pdf')])
    const { contentType, body } = buildMultipartPayload('file', 'evidence.pdf', 'application/pdf', pdfBytes)
    const res = await app.inject({
      method: 'POST', url: '/reports/rpt-1/evidences',
      headers: { 'x-test-user': emp, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
  })

  it('CRITICAL-05: rejeita arquivo cujo conteúdo não bate com o mime declarado', async () => {
    const app = buildApp()
    app.register(multipart)
    app.register(reportsRoute)
    await app.ready()
    const fakePdf = Buffer.from('isso não é um pdf de verdade')
    const { contentType, body } = buildMultipartPayload('file', 'evidence.pdf', 'application/pdf', fakePdf)
    const res = await app.inject({
      method: 'POST', url: '/reports/rpt-1/evidences',
      headers: { 'x-test-user': emp, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita mimetype não permitido', async () => {
    const app = buildApp()
    app.register(multipart)
    app.register(reportsRoute)
    await app.ready()
    const { contentType, body } = buildMultipartPayload('file', 'evil.exe', 'application/x-msdownload', Buffer.from('MZ'))
    const res = await app.inject({
      method: 'POST', url: '/reports/rpt-1/evidences',
      headers: { 'x-test-user': emp, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('aceita vídeo/áudio sem checagem de magic bytes (sem assinatura curta confiável)', async () => {
    const app = buildApp()
    app.register(multipart)
    app.register(reportsRoute)
    await app.ready()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'ev-2' }, error: null }) }),
      }),
    })
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/ev.mp4' }, error: null }),
    })
    const { contentType, body } = buildMultipartPayload('file', 'video.mp4', 'video/mp4', Buffer.from('fake video bytes'))
    const res = await app.inject({
      method: 'POST', url: '/reports/rpt-1/evidences',
      headers: { 'x-test-user': emp, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('PUT /jobs/:id/report', () => {
  it('CRITICAL-02 (IDOR): employee recebe 404 ao editar relatório de job alheio', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'j-9', employee_id: 'emp-outro' }, error: null }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-9/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Editado</p>' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('employee edita relatório do próprio job com sucesso', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'job_reports') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'rpt-1', job_id: 'j-1', content: '<p>Editado</p>' }, error: null }),
            }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Editado</p>' },
    })
    expect(res.statusCode).toBe(200)
  })
})
