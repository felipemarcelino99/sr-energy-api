import { buildApp, mockSupabase } from '../helpers/build-app'
import clientsRoute from '@/routes/clients'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

const clientPayload = {
  razao_social: 'Acme LTDA',
  cnpj: '12345678000199',
  segmento: 'Industrial',
  email: 'contato@acme.com',
  status: 'active',
  endereco: {
    logradouro: 'Rua A', numero: '100', bairro: 'Centro',
    cidade: 'Curitiba', estado: 'PR', cep: '80000000',
  },
}

beforeEach(() => jest.clearAllMocks())

describe('GET /clients', () => {
  it('lista clientes sem filtro de busca', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: [{ id: 'c-1' }], error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/clients', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('MED-09: escapa caracteres especiais no filtro de busca (PostgREST)', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    let orFilter = ''
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          or: jest.fn().mockImplementation((filter: string) => {
            orFilter = filter
            return Promise.resolve({ data: [], error: null })
          }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: '/clients?search=' + encodeURIComponent('a,b.c%d'),
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
    expect(orFilter).toContain('a\\,b\\.c\\%d')
    expect(orFilter).not.toContain('a,b.c%d,')
  })
})

describe('GET /clients/:id', () => {
  it('retorna cliente por id', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'c-1' }, error: null }) }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: '/clients/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando não encontrado', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: '/clients/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /clients', () => {
  it('manager cria cliente', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'c-new', ...clientPayload }, error: null }) }),
      }),
    })
    const res = await app.inject({
      method: 'POST', url: '/clients', headers: { 'x-test-user': mgr }, payload: clientPayload,
    })
    expect(res.statusCode).toBe(201)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/clients', headers: { 'x-test-user': emp }, payload: clientPayload,
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /clients/:id', () => {
  it('manager atualiza cliente', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'c-1', ...clientPayload }, error: null }) }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'PUT', url: '/clients/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': mgr }, payload: clientPayload,
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('DELETE /clients/:id', () => {
  it('admin deleta cliente', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    const admin = JSON.stringify({ id: 'adm-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })
    mockSupabase.from.mockReturnValue({
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })
    const res = await app.inject({
      method: 'DELETE', url: '/clients/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': admin },
    })
    expect(res.statusCode).toBe(204)
  })

  it('manager recebe 403 (só admin pode deletar)', async () => {
    const app = buildApp()
    app.register(clientsRoute, { prefix: '/clients' })
    await app.ready()
    const res = await app.inject({
      method: 'DELETE', url: '/clients/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(403)
  })
})
