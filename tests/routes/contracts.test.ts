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
  it('retorna o contrato', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
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


describe('PATCH /contracts/:id/accept|reject — erro inesperado da RPC', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  it('accept: erro desconhecido vira 500', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'conexão perdida' } })
    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(500)
  })

  it('reject: erro desconhecido vira 500', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'conexão perdida' } })
    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(500)
  })
})

// Sub-plano 04 (fluxo PC-OS), item 1/2: número (AAXXX) e status (pending/accepted/
// rejected) de contracts são gerados/atualizados 100% no banco (DEFAULT next_document_
// number() e RPCs accept_contract/reject_contract) — a rota nunca calcula/lê o
// contador em memória, o que é o que garante a atomicidade sob concorrência (mesma
// lógica de create_job_with_provisioning/adjust_tool_stock do sub-plano 02).
describe('POST /contracts — numeração e status não são calculados na aplicação', () => {
  it('cria contrato sem a rota tocar em document_number_counters (número vem do DEFAULT da coluna)', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const created = { id: 'c-1', client_id: 'cli-1', number: '26001', status: 'pending' }
    const fromSpy = jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
      }),
    })
    mockSupabase.from.mockImplementation(fromSpy)

    const res = await app.inject({
      method: 'POST', url: '/contracts', headers: { 'x-test-user': mgr },
      payload: { client_id: '33333333-3333-4333-a333-333333333333', description: 'PC teste', start_date: '2026-01-01', end_date: '2026-12-31' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().number).toBe('26001')
    expect(res.json().status).toBe('pending')
    // A rota nunca leu/escreveu o contador diretamente — só insert em `contracts`,
    // exatamente como o padrão de RPC/DEFAULT atômico já usado no sub-plano 02.
    expect(fromSpy).not.toHaveBeenCalledWith('document_number_counters')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('PATCH /contracts/:id/accept', () => {
  it('manager aceita PC pendente — RPC accept_contract cria a OS com o mesmo número', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '11111111-1111-1111-1111-111111111111'
    const contract = { id, number: '26001', status: 'accepted' }
    const job = { id: 'j-1', contract_id: id, number: '26001', status: 'pending' }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('accept_contract')
      expect(args).toEqual({ p_contract_id: id })
      return Promise.resolve({ data: { contract, job }, error: null })
    })

    const insertSpy = jest.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().job.number).toBe('26001')
    expect(res.json().contract.status).toBe('accepted')
    expect(mockSupabase.from).toHaveBeenCalledWith('audit_log')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'contract',
      entity_id: id,
      actor_id: 'mgr-1',
      action: 'contract.accepted',
      metadata: { jobId: 'j-1', number: '26001' },
    }))
  })

  it('audit-log é best-effort — falha ao gravar não derruba a resposta 200 do accept', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '11111111-1111-1111-1111-111111111111'
    const contract = { id, number: '26001', status: 'accepted' }
    const job = { id: 'j-1', contract_id: id, number: '26001', status: 'pending' }
    mockSupabase.rpc.mockResolvedValue({ data: { contract, job }, error: null })
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
    })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 409 quando o contrato não está pendente (RPC rejeita a transição)', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '11111111-1111-1111-1111-111111111111'
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `contract ${id} is not pending (status=accepted)` } })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 quando o contrato não existe', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '44444444-4444-4444-4444-444444444444'
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `contract ${id} not found` } })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 403 (só admin/manager decidem proposta comercial)', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '11111111-1111-1111-1111-111111111111'
    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/accept`, headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('PATCH /contracts/:id/reject', () => {
  it('manager recusa PC pendente — mantém histórico, não cria OS', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '22222222-2222-2222-2222-222222222222'
    const contract = { id, number: '26002', status: 'rejected' }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('reject_contract')
      expect(args).toEqual({ p_contract_id: id })
      return Promise.resolve({ data: contract, error: null })
    })
    const insertSpy = jest.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('rejected')
    expect(mockSupabase.from).toHaveBeenCalledWith('audit_log')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'contract',
      entity_id: id,
      actor_id: 'mgr-1',
      action: 'contract.rejected',
    }))
  })

  it('retorna 409 quando o contrato não está pendente', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const id = '22222222-2222-2222-2222-222222222222'
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `contract ${id} is not pending (status=rejected)` } })

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(409)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()
    const id = '22222222-2222-2222-2222-222222222222'

    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}/reject`, headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})
