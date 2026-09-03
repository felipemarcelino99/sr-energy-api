import { buildApp, mockSupabase } from '../helpers/build-app'
import contractsRoute from '@/routes/contracts'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => jest.clearAllMocks())
afterEach(() => mockSupabase.from.mockReturnThis())

describe('GET /contracts/expiring', () => {
  it('retorna contratos que vencem nos próximos 30 dias', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const rows = [{ id: 'c-1', client_name: 'ABC', end_date: in30 }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/contracts/expiring', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('GET /contracts', () => {
  it('lista todos os contratos', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [{ id: 'c-1' }], error: null }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/contracts', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('filtra por clientId', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    const eqSpy = jest.fn().mockResolvedValue({ data: [], error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ eq: eqSpy }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/contracts?clientId=cli-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('client_id', 'cli-1')
  })
})

describe('GET /contracts/:id', () => {
  const id = '11111111-1111-1111-1111-111111111111'

  it('retorna o contrato com proposal: null quando é um contrato manual (sem PC de origem)', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'contracts') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }) }
      }
      if (table === 'proposals') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().proposal).toBeNull()
  })

  it('retorna o contrato com a proposal (PC) de origem quando existir', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    const proposal = { id: 'p-1', number: 'PC-0001' }
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'contracts') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }) }
      }
      if (table === 'proposals') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: proposal, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().proposal).toEqual(proposal)
  })

  it('404 quando não encontrado', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /contracts/:id', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  // NOTA (achado pré-existente, fora do escopo deste sub-plano — não é regressão
  // introduzida aqui): `contractBody.partial()` falha em runtime porque o schema
  // usa `.refine()` (zod v4 não permite `.partial()` em objeto com refinement),
  // então PUT /contracts/:id hoje sempre responde 500. Reportado no resumo final
  // para o dono do módulo decidir se cria ticket; este teste apenas documenta o
  // comportamento real observado, sem "consertar" lógica fora do checklist 1-4.
  it('rota atualmente sempre falha com 500 devido a bug pré-existente (.partial() + .refine() no zod v4)', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }) }),
    })
    const res = await app.inject({ method: 'PUT', url: `/contracts/${id}`, headers: { 'x-test-user': mgr }, payload: { description: 'Nova descrição' } })
    expect(res.statusCode).toBe(500)
  })
})

describe('DELETE /contracts/:id', () => {
  it('admin apaga o contrato', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    const admin = JSON.stringify({ id: 'adm-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })
    const id = '11111111-1111-1111-1111-111111111111'
    mockSupabase.from.mockReturnValue({ delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) })
    const res = await app.inject({ method: 'DELETE', url: `/contracts/${id}`, headers: { 'x-test-user': admin } })
    expect(res.statusCode).toBe(204)
  })

  it('manager (não-admin) recebe 403', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await app.inject({ method: 'DELETE', url: `/contracts/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(403)
  })
})


// Sub-plano 04 (fluxo PC-OS), revisão: `status`/accept/reject saem de `contracts`
// (movidos para `proposals`, ver tests/routes/proposals.test.ts). `contracts`
// agora é só o contrato real — número não tem mais DEFAULT (021_proposals_split.sql),
// pode vir null em contratos manuais/locação.
describe('POST /contracts — criação manual (fluxo de locação)', () => {
  it('cria contrato sem a rota tocar em document_number_counters ou RPC', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const created = { id: 'c-1', client_id: 'cli-1', number: null }
    const fromSpy = jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
      }),
    })
    mockSupabase.from.mockImplementation(fromSpy)

    const res = await app.inject({
      method: 'POST', url: '/contracts', headers: { 'x-test-user': mgr },
      payload: { client_id: '33333333-3333-4333-a333-333333333333', description: 'Locação teste', start_date: '2026-01-01', end_date: '2026-12-31' },
    })
    expect(res.statusCode).toBe(201)
    // A rota nunca leu/escreveu o contador diretamente — só insert em `contracts`.
    expect(fromSpy).not.toHaveBeenCalledWith('document_number_counters')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})
