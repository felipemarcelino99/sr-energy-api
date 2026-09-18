import { buildApp, mockSupabase } from '../helpers/build-app'
import jobsRoute from '@/routes/jobs'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => jest.clearAllMocks())

const jobPayload = {
  employee_id: 'emp-db-1',
  machine_id: 'm-1',
  job_type: 'commissioning',
  description: 'Revisão geral',
  scheduled_date: '2026-05-01',
  city: 'Curitiba',
  state: 'PR',
  accommodation: false,
  car: true,
  start_time: '08:00',
  end_time: '17:00',
}

describe('GET /jobs — manager vê todos', () => {
  it('retorna todos os jobs', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-1', status: 'scheduled' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('GET /jobs — client_name (nome do cliente via contracts→clients)', () => {
  it('retorna client_name resolvido quando o job tem contrato vinculado', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{
      id: 'j-1', status: 'scheduled', number: 'PC-0001',
      contracts: { number: 'PC-0001', clients: { razao_social: 'Empresa Exemplo Ltda' } },
    }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0].client_name).toBe('Empresa Exemplo Ltda')
    expect(res.json()[0].contracts).toBeUndefined()
  })

  it('retorna client_name: null quando o job não tem contract_id (OS manual/legado)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-2', status: 'scheduled', contracts: null }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0].client_name).toBeNull()
  })

  // Sub-plano 01: fonte de verdade nova — jobs.client_id — tem prioridade
  // sobre o fallback via contrato.
  it('retorna client_name resolvido via jobs.client_id direto (sem contrato)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{
      id: 'j-3', status: 'pending', client_id: 'cli-1',
      clients: { razao_social: 'Cliente Direto Ltda' }, contracts: null,
    }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0].client_name).toBe('Cliente Direto Ltda')
    expect(res.json()[0].clients).toBeUndefined()
  })
})

// Sub-plano 01: front pagina a aba "OS" da tela do contrato via este filtro.
describe('GET /jobs — filtro ?contractId=', () => {
  it('filtra jobs pelo contrato vinculado', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const eqSpy = jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [], error: null }) })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: eqSpy }),
    })
    const res = await app.inject({ method: 'GET', url: '/jobs?contractId=c-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('contract_id', 'c-1')
  })
})

describe('GET /jobs — employee vê apenas os próprios', () => {
  it('filtra por employee_id', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-2', employee_id: 'emp-db-1' }]
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      // job_employees: nenhum vínculo adicional (sub-plano 04) — a lista some ao
      // employee_id legado via .or()
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }
      // jobs table
      return {
        select: jest.fn().mockReturnValue({
          or: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }
    })
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /jobs', () => {
  it('manager cria job via RPC transacional (create_job_with_provisioning)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const job = { id: 'j-new', ...jobPayload }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('create_job_with_provisioning')
      expect(args.p_job).toMatchObject(jobPayload)
      return Promise.resolve({ data: { job, insufficient_tools: [] }, error: null })
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { user_id: 'u-1' }, error: null }) }) }),
      }
      if (table === 'notifications') return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('j-new')
    expect(res.json().insufficient_tools).toEqual([])
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('retorna aviso quando ferramenta com estoque insuficiente (vindo da RPC)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const job = { id: 'j-new', ...jobPayload }
    mockSupabase.rpc.mockResolvedValue({ data: { job, insufficient_tools: ['Multímetro'] }, error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload })
    expect(res.statusCode).toBe(201)
    expect(res.json().insufficient_tools).toContain('Multímetro')
  })

  // Sub-plano 01, item 1: job_type legado ('maintenance'/'implementation') não
  // é mais aceito — os 10 slugs novos substituem os antigos por completo.
  it('rejeita job_type legado (400) — só os 10 slugs novos são aceitos', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr },
      payload: { ...jobPayload, job_type: 'maintenance' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('propaga erro da RPC como 500 (garante que não fica estado parcial) — sem chamar notificação', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'job_checklists violates fk' } })
    const fromSpy = jest.fn()
    mockSupabase.from.mockImplementation(fromSpy)

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload })
    expect(res.statusCode).toBe(500)
    // Não deve seguir para buscar employee/inserir notificação de um job que não existe.
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': emp }, payload: jobPayload })
    expect(res.statusCode).toBe(403)
  })

  it('aceita scheduled_end_date opcional (migration 023 — serviço de mais de um dia)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const payloadWithRange = { ...jobPayload, scheduled_end_date: '2026-05-03' }
    const job = { id: 'j-new', ...payloadWithRange }
    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('create_job_with_provisioning')
      expect(args.p_job).toMatchObject(payloadWithRange)
      return Promise.resolve({ data: { job, insufficient_tools: [] }, error: null })
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { user_id: 'u-1' }, error: null }) }) }),
      }
      if (table === 'notifications') return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: payloadWithRange })
    expect(res.statusCode).toBe(201)
    expect(res.json().scheduled_end_date).toBe('2026-05-03')
  })
})

describe('PATCH /jobs/:id/cancel', () => {
  it('muda status para cancelled e restaura estoque (manager)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'j-1', status: 'cancelled' }
    const owned = { id: 'j-1', employee_id: 'emp-db-1' }

    let jobsSelectCall = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        // loadOwnedJob (admin/manager): busca id/employee_id antes de atualizar
        select: jest.fn().mockImplementation(() => {
          jobsSelectCall++
          return { eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: owned, error: null }) }) }
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }),
          }),
        }),
      }
      // restoreToolStock: sem itens → retorna cedo
      if (table === 'job_checklists') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('cancelled')
    expect(jobsSelectCall).toBe(1)
  })

  it('CRITICAL-01 (IDOR): employee recebe 404 ao cancelar job de outro colaborador', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const foreignJob = { id: 'j-9', employee_id: 'emp-outro' }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: foreignJob, error: null }) }),
        }),
      }
      // job_employees: sem vínculo — sub-plano 04, isJobAssignedToEmployee
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-9/cancel', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })

  it('restaura estoque via RPC atômica (adjust_tool_stock) quando há itens no checklist', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'j-1', status: 'cancelled' }
    const owned = { id: 'j-1', employee_id: 'emp-db-1' }
    const checklistItems = [{ tool_id: 't-1', jobs: { machine_id: 'm-1' } }]
    const machineTools = [{ tool_id: 't-1', quantity_required: 2, tools: { id: 't-1' } }]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: owned, error: null }) }) }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }),
          }),
        }),
      }
      if (table === 'job_checklists') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: checklistItems, error: null }) }),
        }),
      }
      if (table === 'machine_tools') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: machineTools, error: null }) }),
      }
      return mockSupabase
    })
    mockSupabase.rpc.mockResolvedValue({ data: 5, error: null })

    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('adjust_tool_stock', { p_tool_id: 't-1', p_delta: 2 })
  })
})

describe('Concorrência — ajuste de estoque não read-modify-write', () => {
  it('duas criações simultâneas de job disparam updates atômicos independentes (sem ler/computar quantity em memória)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    // Cada chamada de create_job_with_provisioning é uma transação isolada no
    // Postgres: o ajuste de estoque dentro dela é `UPDATE tools SET quantity =
    // GREATEST(quantity - x, 0) WHERE id = ...` — uma única instrução SQL, sem
    // round-trip de leitura prévia. Isso é o que elimina a race condition: não
    // existe mais "ler 3, calcular 2, escrever 2" que uma segunda requisição
    // concorrente possa intercalar. Este teste garante que a rota nunca mais
    // lê `tools.quantity` no processo Node antes de decidir o novo valor.
    let callCount = 0
    mockSupabase.rpc.mockImplementation(() => {
      callCount++
      return Promise.resolve({
        data: { job: { id: `j-${callCount}`, ...jobPayload }, insufficient_tools: [] },
        error: null,
      })
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }
      return mockSupabase
    })

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload }),
      app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload }),
    ])

    expect(res1.statusCode).toBe(201)
    expect(res2.statusCode).toBe(201)
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
    // Nenhuma chamada de leitura de estoque (`tools`/`machine_tools`) partiu do
    // processo Node — todo o cálculo aconteceu dentro da transação Postgres.
    expect(mockSupabase.from).not.toHaveBeenCalledWith('tools')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('machine_tools')
  })
})

describe('Falha no meio da criação não deixa registro órfão', () => {
  it('quando a RPC falha (ex.: checklist com FK inválida), nenhum job/estoque/notificação é criado', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    // Simula falha dentro da transação Postgres (ex.: insert em job_checklists
    // viola FK). A função RPC inteira roda como uma transação — a falha faz o
    // Postgres desfazer o insert do job e os updates de estoque já feitos
    // antes do erro, então a resposta é só um 500, sem job/checklist/estoque
    // parcialmente gravados.
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'insert or update on table "job_checklists" violates foreign key constraint' },
    })
    const fromSpy = jest.fn()
    mockSupabase.from.mockImplementation(fromSpy)

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('foreign key')
    // Como o job nunca existiu (rollback), a rota não deve tentar notificar
    // ninguém sobre um job inexistente.
    expect(fromSpy).not.toHaveBeenCalledWith('employees')
    expect(fromSpy).not.toHaveBeenCalledWith('notifications')
  })
})

describe('PUT /jobs/:id — CRITICAL-01 (IDOR)', () => {
  const employeeEditPayload = {
    job_type: 'commissioning',
    description: 'Revisão geral',
    city: 'Curitiba',
    state: 'PR',
    accommodation: false,
    car: true,
    start_time: '08:00',
    end_time: '17:00',
  }

  it('employee edita job próprio com sucesso (sem campos administrativos)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const owned = { id: 'j-1', employee_id: 'emp-db-1' }
    const updated = { id: 'j-1', ...employeeEditPayload }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: owned, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': emp }, payload: employeeEditPayload,
    })
    expect(res.statusCode).toBe(200)
  })

  it('employee recebe 404 ao editar job de outro colaborador', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const foreignJob = { id: 'j-9', employee_id: 'emp-outro' }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: foreignJob, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-9', headers: { 'x-test-user': emp }, payload: employeeEditPayload,
    })
    expect(res.statusCode).toBe(404)
  })

  // Sub-plano 01, item 4: PUT genuinamente parcial — antes o admin/manager
  // precisava reenviar TODOS os campos de jobBody até pra editar um só, o que
  // travava completar a OS "esqueleto" nascida do aceite de uma PC aos
  // poucos. Envia só `job_type` e confirma que a rota não recusa por faltar
  // os demais campos administrativos (employee_id, machine_id, etc.).
  it('manager completa a OS esqueleto enviando só um campo (PUT parcial)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const skeleton = { id: 'j-os-1', employee_id: null }
    let updatePayload: any = null

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: skeleton, error: null }) }),
        }),
        update: jest.fn().mockImplementation((payload: any) => {
          updatePayload = payload
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-os-1', job_type: 'commissioning' }, error: null }) }),
            }),
          }
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-os-1', headers: { 'x-test-user': mgr },
      payload: { job_type: 'commissioning' },
    })
    expect(res.statusCode).toBe(200)
    expect(updatePayload.job_type).toBe('commissioning')
    expect(updatePayload.employee_id).toBeUndefined()
    expect(updatePayload.city).toBeUndefined()
  })

  it('manager: bag_id e scheduled_end_date vazios (\'\') viram null antes do update (Postgres rejeita \'\' pra uuid/date)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const owned = { id: 'j-1', employee_id: 'emp-db-1' }
    let updatePayload: any = null

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: owned, error: null }) }),
        }),
        update: jest.fn().mockImplementation((payload: any) => {
          updatePayload = payload
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1' }, error: null }) }),
            }),
          }
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': mgr },
      payload: { ...jobPayload, bag_id: '', scheduled_end_date: '' },
    })
    expect(res.statusCode).toBe(200)
    expect(updatePayload.bag_id).toBeNull()
    expect(updatePayload.scheduled_end_date).toBeNull()
  })

  it('CRITICAL-01: campo administrativo (employee_id) enviado por employee é ignorado no update', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const owned = { id: 'j-1', employee_id: 'emp-db-1' }
    let updatePayload: any = null

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: owned, error: null }) }),
        }),
        update: jest.fn().mockImplementation((payload: any) => {
          updatePayload = payload
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1' }, error: null }) }),
            }),
          }
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': emp },
      payload: { ...employeeEditPayload, employee_id: 'emp-outro', machine_id: 'm-outro' },
    })
    expect(res.statusCode).toBe(200)
    expect(updatePayload.employee_id).toBeUndefined()
    expect(updatePayload.machine_id).toBeUndefined()
  })
})

describe('GET /jobs/:id — CRITICAL-07 (IDOR)', () => {
  it('employee recebe 404 ao acessar job de outro colaborador', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const foreignJob = { id: 'j-9', employee_id: 'emp-outro' }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: foreignJob, error: null }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'GET', url: '/jobs/j-9', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })

  it('employee acessa job próprio com sucesso', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const ownJob = { id: 'j-1', employee_id: 'emp-db-1', employees: { name: 'João' }, machines: { name: 'M1' } }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: ownJob, error: null }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'GET', url: '/jobs/j-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
    expect(res.json().proposal).toBeNull()
  })
})

// Sub-plano 01 (épico ajustes-cliente-2026-09): `jobs.proposal_id` é FK direta
// (antes era resolvido via query reversa em `proposals.job_id`) — o vínculo
// vem embedado no mesmo select de `jobs`, sob a chave `proposals` (nome da
// tabela, mesmo padrão de `employees`/`machines`).
describe('GET /jobs/:id — vínculo com proposal (PC) de origem via jobs.proposal_id', () => {
  const id = 'j-1'
  const jobBase = { id, employee_id: 'emp-db-1', employees: { name: 'João' }, machines: { name: 'M1' } }

  it('retorna proposal: null quando a OS não nasceu de uma PC (fluxo manual)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: jobBase, error: null }) }) }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'GET', url: `/jobs/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().proposal).toBeNull()
  })

  it('retorna a proposal (PC) de origem quando existir', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const proposal = { id: 'p-1', number: 'PC-0001', status: 'accepted' }
    const jobWithProposal = { ...jobBase, proposals: proposal }
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: jobWithProposal, error: null }) }) }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'GET', url: `/jobs/${id}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().proposal).toEqual(proposal)
  })
})

describe('loadOwnedJob — ramos de 404 pré-existentes (cobertura)', () => {
  it('manager recebe 404 ao cancelar job inexistente', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-none/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 404 ao editar job quando não existe registro de employee vinculado ao user', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': emp },
      payload: { job_type: 'commissioning', description: 'x', city: 'Curitiba', state: 'PR', accommodation: false, car: true, start_time: '08:00', end_time: '17:00' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 404 ao cancelar job inexistente (jobs select falha)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }) }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-none/cancel', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })
})

describe('job_employees — sub-plano 04 (múltiplos colaboradores por OS)', () => {
  it('employee sem employee_id legado, mas vinculado via job_employees, acessa o job (GET /:id)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    // OS "esqueleto" criada via accept_contract não tem employee_id legado (nasce
    // com colunas operacionais nulas, ver 017_jobs_pc_os_extension.sql) — o vínculo
    // vem só de job_employees.
    const job = { id: 'j-os-1', employee_id: null, employees: null, machines: null }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: job, error: null }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { job_id: 'j-os-1' }, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'GET', url: '/jobs/j-os-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('CRITICAL (IDOR, não regredir sub-plano 01): employee vinculado a OUTRA OS via job_employees não acessa este job', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const job = { id: 'j-os-2', employee_id: null }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: job, error: null }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      // Não vinculado a j-os-2 — só a outros jobs.
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'GET', url: '/jobs/j-os-2', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })

  it('GET /jobs inclui jobs vinculados só via job_employees (sem employee_id legado)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{ id: 'j-os-1', employee_id: null }]

    let orFilter = ''
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [{ job_id: 'j-os-1' }], error: null }),
        }),
      }
      return {
        select: jest.fn().mockReturnValue({
          or: jest.fn().mockImplementation((filter: string) => {
            orFilter = filter
            return { order: jest.fn().mockResolvedValue({ data: rows, error: null }) }
          }),
        }),
      }
    })

    const res = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
    expect(orFilter).toContain('id.in.(j-os-1)')
    expect(orFilter).toContain('employee_id.eq.emp-db-1')
  })
})

describe('GET /jobs/:id/checklist', () => {
  it('retorna itens do checklist do job', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const items = [{ id: 'c-1', job_id: 'j-1', checked: false, phase: 'pre_work', tools: { id: 't-1', name: 'Multímetro' } }]
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: null }, error: null }) }) }),
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: items, error: null }),
          }),
        }),
      }
    })
    const res = await app.inject({ method: 'GET', url: '/jobs/j-1/checklist', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('PATCH /jobs/:id/checklist/:itemId', () => {
  it('marca item como checked', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'c-1', checked: true, checked_at: '2026-05-01T10:00:00Z' }
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: null }, error: null }) }) }),
      }
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }),
            }),
          }),
        }),
      }
    })
    const res = await app.inject({
      method: 'PATCH', url: '/jobs/j-1/checklist/c-1', headers: { 'x-test-user': mgr },
      payload: { checked: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().checked).toBe(true)
  })

  it('retorna 400 com body inválido', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: null }, error: null }) }) }),
    })
    const res = await app.inject({
      method: 'PATCH', url: '/jobs/j-1/checklist/c-1', headers: { 'x-test-user': mgr },
      payload: { checked: 'sim' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /jobs/:id/checklist/duplicate', () => {
  it('duplica pre_work para pre_report', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const preWorkItems = [{ id: 'c-1', job_id: 'j-1', employee_id: 'emp-db-1', tool_id: 't-1', phase: 'pre_work' }]
    const newItems = [{ id: 'c-2', job_id: 'j-1', tool_id: 't-1', phase: 'pre_report', tools: { id: 't-1', name: 'Multímetro' } }]
    let callCount = 0

    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { // loadOwnedJob
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: null }, error: null }) }),
        }),
      }
      if (callCount === 2) return { // verifica existência de pre_report
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }
      if (callCount === 3) return { // busca pre_work
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: preWorkItems, error: null }),
          }),
        }),
      }
      return { // insert pre_report
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: newItems, error: null }),
        }),
      }
    })

    const res = await app.inject({ method: 'POST', url: '/jobs/j-1/checklist/duplicate', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(201)
    expect(res.json()[0].phase).toBe('pre_report')
  })

  it('retorna checklist existente se pre_report já foi criado', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const existing = [{ id: 'c-2', phase: 'pre_report', tools: {} }]
    let callCount = 0

    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { // loadOwnedJob
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: null }, error: null }) }),
        }),
      }
      if (callCount === 2) return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: existing, error: null }),
            }),
          }),
        }),
      }
      return { // busca os itens existentes
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: existing, error: null }),
            }),
          }),
        }),
      }
    })

    const res = await app.inject({ method: 'POST', url: '/jobs/j-1/checklist/duplicate', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('PUT /jobs/:id — sub-plano 04, item 4/12 (employee_ids / job_employees)', () => {
  const managerEditPayload = {
    employee_id: 'emp-db-1',
    machine_id: 'm-1',
    job_type: 'commissioning',
    description: 'Revisão geral',
    scheduled_date: '2026-05-01',
    city: 'Curitiba',
    state: 'PR',
    accommodation: false,
    car: true,
    start_time: '08:00',
    end_time: '17:00',
    employee_ids: ['emp-db-1', 'emp-db-2'],
  }

  it('manager substitui os colaboradores atribuídos à OS via employee_ids', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const deleteEq = jest.fn().mockResolvedValue({ error: null })
    const insertLinks = jest.fn().mockResolvedValue({ error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: 'emp-db-1' }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1' }, error: null }) }),
          }),
        }),
      }
      if (table === 'job_employees') return {
        delete: jest.fn().mockReturnValue({ eq: deleteEq }),
        insert: insertLinks,
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': mgr }, payload: managerEditPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(deleteEq).toHaveBeenCalledWith('job_id', 'j-1')
    expect(insertLinks).toHaveBeenCalledWith([
      { job_id: 'j-1', employee_id: 'emp-db-1' },
      { job_id: 'j-1', employee_id: 'emp-db-2' },
    ])
  })

  it('manager persiste scheduled_end_date opcional (migration 023 — serviço de mais de um dia)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    let updatePayload: any = null

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: 'emp-db-1' }, error: null }) }),
        }),
        update: jest.fn().mockImplementation((payload: any) => {
          updatePayload = payload
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', scheduled_end_date: '2026-05-03' }, error: null }) }),
            }),
          }
        }),
      }
      if (table === 'job_employees') return {
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': mgr },
      payload: { ...managerEditPayload, scheduled_end_date: '2026-05-03' },
    })
    expect(res.statusCode).toBe(200)
    expect(updatePayload.scheduled_end_date).toBe('2026-05-03')
    expect(res.json().scheduled_end_date).toBe('2026-05-03')
  })

  it('employee_ids enviado por employee é ignorado (campo administrativo)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const linkTouched = jest.fn()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', employee_id: 'emp-db-1' }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1' }, error: null }) }),
          }),
        }),
      }
      if (table === 'job_employees') {
        linkTouched()
        return { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) }
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-1', headers: { 'x-test-user': emp },
      payload: {
        job_type: 'commissioning', description: 'Revisão geral', city: 'Curitiba', state: 'PR',
        accommodation: false, car: true, start_time: '08:00', end_time: '17:00',
        employee_ids: ['emp-db-9'],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(linkTouched).not.toHaveBeenCalled()
  })
})

// Sub-plano 02 (épico ajustes-cliente-2026-09), item 3: agenda somente
// leitura, qualquer role autenticada, campos mínimos (sem valores/dados de
// contato do cliente).
describe('GET /jobs/calendar', () => {
  it('400 quando from/to estão ausentes', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/jobs/calendar', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(400)
  })

  it('400 quando from/to não são datas válidas', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=not-a-date&to=2026-05-31',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 quando o intervalo passa de 62 dias', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=2026-01-01&to=2026-12-31',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400 quando to é anterior a from', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=2026-05-10&to=2026-05-01',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(400)
  })

  // Employee (qualquer role autenticada) vê a OS de OUTROS funcionários, com
  // color/photo_url e SEM dados sensíveis (valores, contato do cliente).
  it('employee vê OS de outros funcionários, com color/photo_url e sem dados sensíveis', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{
      id: 'j-1', number: 'OS-1', status: 'scheduled', job_type: 'commissioning',
      scheduled_date: '2026-05-01', scheduled_end_date: null, start_time: '08:00', end_time: '17:00',
      city: 'Curitiba', state: 'PR',
      clients: { razao_social: 'Cliente X' },
      contracts: null,
      employees: { id: 'emp-outro', name: 'Outro Funcionário', color: '#3cb44b', photo_path: 'employees/emp-outro.jpg' },
      job_employees: [],
    }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            neq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    })
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/emp-outro.jpg' }, error: null }),
    })
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=2026-05-01&to=2026-05-31',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].client_name).toBe('Cliente X')
    expect(body[0].employees).toEqual([
      { id: 'emp-outro', name: 'Outro Funcionário', color: '#3cb44b', photo_url: 'https://signed.example/emp-outro.jpg' },
    ])
    // Sem dados sensíveis: nenhum campo financeiro/contato do cliente no payload.
    expect(body[0].contract_value).toBeUndefined()
    expect(body[0].client_contact_name).toBeUndefined()
    expect(body[0].client_contact_phone).toBeUndefined()
    expect(body[0].address).toBeUndefined()
  })

  it('exclui OS canceladas por padrão (via .neq no select)', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    let neqCalledWith: any = null
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            neq: jest.fn().mockImplementation((field: string, value: string) => {
              neqCalledWith = [field, value]
              return { order: jest.fn().mockResolvedValue({ data: [], error: null }) }
            }),
          }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=2026-05-01&to=2026-05-31',
      headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(200)
    expect(neqCalledWith).toEqual(['status', 'cancelled'])
  })

  // buildCalendarEntry: dedup de colaboradores (employee_id legado +
  // job_employees) e photo_url null quando o funcionário não tem foto.
  it('junta employee_id legado com job_employees (deduplicado) e trata funcionário sem foto', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const rows = [{
      id: 'j-2', number: 'OS-2', status: 'in_progress', job_type: 'taf',
      scheduled_date: '2026-05-05', scheduled_end_date: '2026-05-06', start_time: '08:00', end_time: '17:00',
      city: 'Joinville', state: 'SC',
      clients: null,
      contracts: { clients: { razao_social: 'Cliente Y (via contrato)' } },
      // Mesmo funcionário aparece como assignee legado E em job_employees —
      // não pode duplicar na lista final.
      employees: { id: 'emp-legado', name: 'Legado', color: null, photo_path: null },
      job_employees: [
        { employees: { id: 'emp-legado', name: 'Legado', color: null, photo_path: null } },
        { employees: { id: 'emp-extra', name: 'Extra', color: '#4363d8', photo_path: 'employees/emp-extra.jpg' } },
      ],
    }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            neq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    })
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/emp-extra.jpg' }, error: null }),
    })
    const res = await app.inject({
      method: 'GET', url: '/jobs/calendar?from=2026-05-01&to=2026-05-31',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body[0].client_name).toBe('Cliente Y (via contrato)')
    expect(body[0].employees).toHaveLength(2)
    const legado = body[0].employees.find((e: any) => e.id === 'emp-legado')
    expect(legado.photo_url).toBeNull()
    const extra = body[0].employees.find((e: any) => e.id === 'emp-extra')
    expect(extra.photo_url).toBe('https://signed.example/emp-extra.jpg')
  })
})

// Sub-plano 02, item 4: início da OS — admin/manager e colaborador vinculado
// (employee_id legado OU job_employees).
describe('PATCH /jobs/:id/start', () => {
  it('manager inicia OS em scheduled com sucesso', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', status: 'scheduled', employee_id: 'emp-db-1' }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', status: 'in_progress' }, error: null }) }) }),
        }),
      }
      if (table === 'audit_log') return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/start', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('in_progress')
  })

  it('409 quando a OS não está em scheduled/pending', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', status: 'completed', employee_id: 'emp-db-1' }, error: null }) }),
        }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/start', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(409)
  })

  it('employee dono (employee_id legado) inicia a própria OS', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', status: 'pending', employee_id: 'emp-db-1' }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-1', status: 'in_progress' }, error: null }) }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'audit_log') return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/start', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  // Colaborador só presente em job_employees (sem employee_id legado) — mesmo
  // achado do assertJobOwnership de reports.ts, corrigido aqui desde o início.
  it('colaborador só presente em job_employees consegue iniciar a OS', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-os-1', status: 'scheduled', employee_id: null }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-os-1', status: 'in_progress' }, error: null }) }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-linked-1' }, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { job_id: 'j-os-1' }, error: null }) }),
          }),
        }),
      }
      if (table === 'audit_log') return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-os-1/start', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('CRITICAL (IDOR): employee sem vínculo recebe 404, não 403', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'j-9', status: 'scheduled', employee_id: 'emp-outro' }, error: null }) }),
        }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }) }),
        }),
      }
      if (table === 'job_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }),
      }
      return mockSupabase
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-9/start', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(404)
  })
})
