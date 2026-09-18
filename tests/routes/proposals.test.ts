import { buildApp, mockSupabase } from '../helpers/build-app'
import proposalsRoute from '@/routes/proposals'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => jest.clearAllMocks())
afterEach(() => mockSupabase.from.mockReturnThis())

describe('GET /proposals', () => {
  it('lista todas as propostas', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [{ id: 'p-1' }], error: null }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/proposals', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('filtra por clientId', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const eqSpy = jest.fn().mockResolvedValue({ data: [], error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ eq: eqSpy }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/proposals?clientId=cli-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('client_id', 'cli-1')
  })

  it('employee (autenticado) pode listar', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [], error: null }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/proposals', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  // Sub-plano 01: front pagina a aba "PCs" da tela do contrato via este filtro.
  it('filtra por contractId', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const eqSpy = jest.fn().mockResolvedValue({ data: [], error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ eq: eqSpy }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/proposals?contractId=c-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('contract_id', 'c-1')
  })
})

describe('GET /proposals/:id', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  it('retorna a proposta', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/proposals/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('quando a proposta está aceita, retorna contrato vinculado e OS embedados', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    // Sub-plano 01: `contracts` embed ficou enxuto (só id/number) — aceitar
    // uma PC não gera mais um Contrato automaticamente, o que aparece aqui é
    // um Contrato grande vinculado manualmente pelo gestor.
    const contract = { id: 'c-1', number: '26001' }
    const job = {
      id: 'j-1', number: '26001', status: 'scheduled', scheduled_date: '2026-02-01', scheduled_end_date: null,
      city: 'Curitiba', state: 'PR', employees: { name: 'João' }, machines: { name: 'Retro' },
    }
    const data = { id, status: 'accepted', contract_id: 'c-1', job_id: 'j-1', contracts: contract, jobs: job }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/proposals/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().contracts).toEqual(contract)
    expect(res.json().jobs).toEqual(job)
  })

  it('404 quando não encontrado', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/proposals/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /proposals', () => {
  it('manager cria PC nova — status/number nunca vêm do body', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const created = { id: 'p-1', client_id: 'cli-1', number: '26001', status: 'pending' }
    const insertSpy = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
    })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({
      method: 'POST', url: '/proposals', headers: { 'x-test-user': mgr },
      payload: { client_id: '33333333-3333-4333-a333-333333333333', description: 'PC teste', start_date: '2026-01-01' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().number).toBe('26001')
    expect(res.json().status).toBe('pending')
    expect(insertSpy).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything(), number: expect.anything() }))
  })

  // Sub-plano 01, item 3: `start_date` vira opcional — a PC não tem mais
  // nenhuma data obrigatória (só `description`/`client_id`).
  it('manager cria PC sem nenhuma data (start_date opcional)', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const created = { id: 'p-2', client_id: 'cli-1', number: '26002', status: 'pending', start_date: null }
    const insertSpy = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
    })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({
      method: 'POST', url: '/proposals', headers: { 'x-test-user': mgr },
      payload: { client_id: '33333333-3333-4333-a333-333333333333', description: 'PC sem data' },
    })
    expect(res.statusCode).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(expect.not.objectContaining({ start_date: expect.anything() }))
  })

  // Sub-plano 01, item 3: `contract_id` opcional — se informado, precisa
  // apontar pra um Contrato do mesmo cliente da PC (senão 400).
  it('400 quando contract_id aponta pra contrato de outro cliente', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const contractId = '44444444-4444-4444-a444-444444444444'
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'contracts') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: contractId, client_id: 'outro-cliente' }, error: null }) }),
        }),
      }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({
      method: 'POST', url: '/proposals', headers: { 'x-test-user': mgr },
      payload: {
        client_id: '33333333-3333-4333-a333-333333333333', description: 'PC teste',
        contract_id: contractId,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  // Sub-plano 01: contract_id válido (mesmo client_id) segue pro insert normal.
  it('cria PC com contract_id vinculado quando o contrato é do mesmo cliente', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const clientId = '33333333-3333-4333-a333-333333333333'
    const contractId = '44444444-4444-4444-a444-444444444444'
    const created = { id: 'p-3', client_id: clientId, number: '26003', status: 'pending', contract_id: contractId }
    const insertSpy = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'contracts') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: contractId, client_id: clientId }, error: null }) }),
        }),
      }
      if (table === 'proposals') return { insert: insertSpy }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({
      method: 'POST', url: '/proposals', headers: { 'x-test-user': mgr },
      payload: { client_id: clientId, description: 'PC teste', contract_id: contractId },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().contract_id).toBe(contractId)
  })

  it('400 quando body inválido', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/proposals', headers: { 'x-test-user': mgr }, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/proposals', headers: { 'x-test-user': emp },
      payload: { client_id: '33333333-3333-4333-a333-333333333333', description: 'PC teste', start_date: '2026-01-01' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /proposals/:id', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  // Fix: mesmo padrão de tests/routes/contracts.test.ts — `proposalBody` dividido
  // em base (aceita .partial()) + refine aplicado depois.
  it('atualiza parcialmente (200) — regressão do bug .partial()+.refine() no zod v4', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id }, error: null }) }) }) }),
    })
    const res = await app.inject({ method: 'PUT', url: `/proposals/${id}`, headers: { 'x-test-user': mgr }, payload: { description: 'Nova descrição' } })
    expect(res.statusCode).toBe(200)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const res = await app.inject({ method: 'PUT', url: `/proposals/${id}`, headers: { 'x-test-user': emp }, payload: { description: 'x' } })
    expect(res.statusCode).toBe(403)
  })

  // Sub-plano 01, item 3: PUT parcial sem client_id no payload — busca o
  // client_id já gravado da PC pra validar o contract_id informado.
  it('400 quando contract_id (PUT parcial, sem client_id no body) aponta pra contrato de outro cliente', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const contractId = '44444444-4444-4444-a444-444444444444'
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'proposals') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { client_id: 'cli-dono' }, error: null }) }),
        }),
      }
      if (table === 'contracts') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: contractId, client_id: 'outro-cliente' }, error: null }) }),
        }),
      }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({
      method: 'PUT', url: `/proposals/${id}`, headers: { 'x-test-user': mgr },
      payload: { contract_id: contractId },
    })
    expect(res.statusCode).toBe(400)
  })

  // Sub-plano 01: client_id explícito no body do PUT — não precisa buscar a
  // PC atual pra validar o contract_id.
  it('vincula contract_id válido quando client_id vem junto no mesmo PUT', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const clientId = '33333333-3333-4333-a333-333333333333'
    const contractId = '44444444-4444-4444-a444-444444444444'
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'contracts') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: contractId, client_id: clientId }, error: null }) }),
        }),
      }
      if (table === 'proposals') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id, contract_id: contractId }, error: null }) }) }),
        }),
      }
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({
      method: 'PUT', url: `/proposals/${id}`, headers: { 'x-test-user': mgr },
      payload: { client_id: clientId, contract_id: contractId },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().contract_id).toBe(contractId)
  })
})

describe('PATCH /proposals/:id/accept', () => {
  const id = '11111111-1111-1111-1111-111111111111'

  // Sub-plano 01, item 1: aceitar não cria mais Contrato — só a OS, já
  // vinculada direto à PC (proposal_id) e ao cliente (client_id), sem
  // contract_id (PC sem contrato grande escolhido).
  it('manager aceita PC pendente sem contrato vinculado — RPC accept_proposal cria SÓ a OS', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const proposal = { id, number: '26001', status: 'accepted', contract_id: null, job_id: 'j-1' }
    const job = { id: 'j-1', proposal_id: id, client_id: 'cli-1', contract_id: null, number: '26001', status: 'pending' }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('accept_proposal')
      expect(args).toEqual({ p_proposal_id: id })
      return Promise.resolve({ data: { proposal, job }, error: null })
    })

    const insertSpy = jest.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().job.id).toBe('j-1')
    expect(res.json().job.contract_id).toBeNull()
    expect(res.json().contract).toBeUndefined()
    expect(res.json().proposal.status).toBe('accepted')
    expect(mockSupabase.from).toHaveBeenCalledWith('audit_log')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'proposal',
      entity_id: id,
      actor_id: 'mgr-1',
      action: 'proposal.accepted',
      metadata: { jobId: 'j-1', number: '26001' },
    }))
  })

  // Sub-plano 01: quando a PC já tinha um Contrato grande escolhido
  // (`proposals.contract_id`), a OS herda esse vínculo no aceite.
  it('manager aceita PC com contrato vinculado — OS herda o contract_id da PC', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const proposal = { id, number: '26001', status: 'accepted', contract_id: 'c-1', job_id: 'j-1' }
    const job = { id: 'j-1', proposal_id: id, client_id: 'cli-1', contract_id: 'c-1', number: '26001', status: 'pending' }
    mockSupabase.rpc.mockResolvedValue({ data: { proposal, job }, error: null })
    mockSupabase.from.mockReturnValue({ insert: jest.fn().mockResolvedValue({ data: null, error: null }) })

    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().job.contract_id).toBe('c-1')
  })

  it('audit-log é best-effort — falha ao gravar não derruba a resposta 200 do accept', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const proposal = { id, number: '26001', status: 'accepted' }
    const job = { id: 'j-1', contract_id: null, number: '26001', status: 'pending' }
    mockSupabase.rpc.mockResolvedValue({ data: { proposal, job }, error: null })
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
    })

    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 409 quando a proposta não está pendente', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `proposal ${id} is not pending (status=accepted)` } })
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('Proposta não está pendente')
  })

  it('retorna 404 quando a proposta não existe', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `proposal ${id} not found` } })
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('erro desconhecido vira 500', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'conexão perdida' } })
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(500)
  })

  it('employee recebe 403 (só admin/manager decidem proposta comercial)', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/accept`, headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('PATCH /proposals/:id/reject', () => {
  const id = '22222222-2222-2222-2222-222222222222'

  it('manager recusa PC pendente — mantém histórico, não cria Contrato/OS', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()

    const proposal = { id, number: '26002', status: 'rejected' }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('reject_proposal')
      expect(args).toEqual({ p_proposal_id: id })
      return Promise.resolve({ data: proposal, error: null })
    })
    const insertSpy = jest.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockReturnValue({ insert: insertSpy })

    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('rejected')
    expect(mockSupabase.from).toHaveBeenCalledWith('audit_log')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'proposal',
      entity_id: id,
      actor_id: 'mgr-1',
      action: 'proposal.rejected',
    }))
  })

  it('retorna 409 quando a proposta não está pendente', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `proposal ${id} is not pending (status=rejected)` } })
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(409)
  })

  it('retorna 404 quando a proposta não existe', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: `proposal ${id} not found` } })
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/reject`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(proposalsRoute, { prefix: '/proposals' })
    await app.ready()
    const res = await app.inject({ method: 'PATCH', url: `/proposals/${id}/reject`, headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})
