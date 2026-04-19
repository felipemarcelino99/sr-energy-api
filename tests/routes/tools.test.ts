import { buildApp, mockSupabase } from '../helpers/build-app'
import toolsRoute from '@/routes/tools'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

const toolRow = { id: 't-1', name: 'Multímetro', description: 'Medidor', status: 'active', quantity: 5 }

beforeEach(() => jest.clearAllMocks())

describe('GET /tools', () => {
  it('retorna lista de ferramentas', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: [toolRow], error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/tools', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por status quando query param fornecido', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [toolRow], error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/tools?status=active', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /tools/:id', () => {
  it('retorna ferramenta pelo id', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: toolRow, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/tools/t-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Multímetro')
  })

  it('retorna 404 quando não encontrado', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/tools/inexistente', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /tools', () => {
  it('manager cria ferramenta com sucesso', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: toolRow, error: null }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST', url: '/tools', headers: { 'x-test-user': mgr },
      payload: { name: 'Multímetro', quantity: 5 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('Multímetro')
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/tools', headers: { 'x-test-user': emp },
      payload: { name: 'Multímetro', quantity: 5 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('retorna 400 com body inválido', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/tools', headers: { 'x-test-user': mgr },
      payload: { quantity: -1 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /tools/:id', () => {
  it('manager atualiza ferramenta', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    const updated = { ...toolRow, quantity: 10 }
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'PUT', url: '/tools/t-1', headers: { 'x-test-user': mgr },
      payload: { name: 'Multímetro', quantity: 10 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().quantity).toBe(10)
  })
})

describe('DELETE /tools/:id', () => {
  it('manager desativa ferramenta (soft delete)', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { ...toolRow, status: 'inactive' }, error: null }),
          }),
        }),
      }),
    })
    const res = await app.inject({ method: 'DELETE', url: '/tools/t-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(toolsRoute, { prefix: '/tools' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: '/tools/t-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
  })
})
