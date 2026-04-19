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
  it('manager cria job, gera checklist e reduz estoque', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const job = { id: 'j-new', ...jobPayload }
    const machineTools = [{ tool_id: 't-1', quantity_required: 1, tools: { id: 't-1', name: 'Multímetro', quantity: 3 } }]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: job, error: null }) }) }),
      }
      if (table === 'machine_tools') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: machineTools, error: null }) }),
      }
      if (table === 'tools') return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'job_checklists') return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
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
  })

  it('retorna aviso quando ferramenta com estoque insuficiente', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()

    const job = { id: 'j-new', ...jobPayload }
    const machineTools = [{ tool_id: 't-1', quantity_required: 5, tools: { id: 't-1', name: 'Multímetro', quantity: 1 } }]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
        insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: job, error: null }) }) }),
      }
      if (table === 'machine_tools') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: machineTools, error: null }) }),
      }
      if (table === 'tools') return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'job_checklists') return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'POST', url: '/jobs', headers: { 'x-test-user': mgr }, payload: jobPayload })
    expect(res.statusCode).toBe(201)
    expect(res.json().insufficient_tools).toContain('Multímetro')
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
  it('muda status para cancelled e restaura estoque', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'j-1', status: 'cancelled' }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') return {
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
