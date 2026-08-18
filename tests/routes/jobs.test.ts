import { buildApp, mockSupabase } from '../helpers/build-app'
import jobsRoute from '@/routes/jobs'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => jest.clearAllMocks())

const jobPayload = {
  employee_id: 'emp-db-1',
  machine_id: 'm-1',
  job_type: 'maintenance',
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
      // jobs table
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
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
    job_type: 'maintenance',
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
      return mockSupabase
    })

    const res = await app.inject({
      method: 'PUT', url: '/jobs/j-9', headers: { 'x-test-user': emp }, payload: employeeEditPayload,
    })
    expect(res.statusCode).toBe(404)
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
  })
})

describe('GET /jobs/:id/checklist', () => {
  it('retorna itens do checklist do job', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const items = [{ id: 'c-1', job_id: 'j-1', checked: false, phase: 'pre_work', tools: { id: 't-1', name: 'Multímetro' } }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: items, error: null }),
        }),
      }),
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
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }),
          }),
        }),
      }),
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
      if (callCount === 1) return { // verifica existência de pre_report
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }
      if (callCount === 2) return { // busca pre_work
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
      if (callCount === 1) return {
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
