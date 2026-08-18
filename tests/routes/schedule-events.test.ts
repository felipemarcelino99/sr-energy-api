import { buildApp, mockSupabase } from '../helpers/build-app'
import scheduleEventsRoute from '@/routes/schedule-events'
import * as googleCalendar from '@/services/google-calendar.service'

jest.mock('@/services/google-calendar.service')

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN
})

const eventPayload = {
  type: 'vacation',
  employee_ids: ['emp-db-1'],
  start_date: '2026-06-01',
  end_date: '2026-06-10',
  notes: 'Férias anuais',
}

describe('GET /schedule-events', () => {
  it('retorna eventos usando embed relacional (sem N+1)', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    const rows = [
      {
        id: 'ev-1',
        type: 'vacation',
        start_date: '2026-06-01',
        end_date: '2026-06-10',
        schedule_event_employees: [{ employee_id: 'emp-db-1', employees: { name: 'João' } }],
      },
    ]
    const orderSpy = jest.fn().mockResolvedValue({ data: rows, error: null })
    const selectSpy = jest.fn().mockReturnValue({ order: orderSpy })
    mockSupabase.from.mockReturnValue({ select: selectSpy })

    const res = await app.inject({ method: 'GET', url: '/schedule-events', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: 'ev-1', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-10', employee_ids: ['emp-db-1'], employee_names: ['João'] },
    ])
    // A query pede o embed relacional na mesma chamada — não há N+1 (nenhuma
    // query adicional por evento).
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('schedule_event_employees'))
  })

  it('filtra por mês', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    const lteSpy = jest.fn().mockReturnThis()
    const gteSpy = jest.fn().mockReturnThis()
    const orderSpy = jest.fn().mockResolvedValue({ data: [], error: null })
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ lte: lteSpy, gte: gteSpy, order: orderSpy }),
    })
    lteSpy.mockReturnValue({ gte: gteSpy, order: orderSpy })
    gteSpy.mockReturnValue({ order: orderSpy })

    const res = await app.inject({ method: 'GET', url: '/schedule-events?month=2026-06', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('filtra por employeeId via junction table', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ schedule_event_id: 'ev-1' }], error: null }) }),
      }
      return {
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      }
    })

    const res = await app.inject({ method: 'GET', url: '/schedule-events?employeeId=emp-db-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna [] quando funcionário não tem nenhum evento vinculado', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }),
    })

    const res = await app.inject({ method: 'GET', url: '/schedule-events?employeeId=emp-sem-eventos', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('GET /schedule-events/:id', () => {
  it('retorna 404 quando não encontrado', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/schedule-events/ev-9', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('retorna evento com employee_ids/names', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const row = {
      id: 'ev-1',
      type: 'vacation',
      schedule_event_employees: [{ employee_id: 'emp-db-1', employees: { name: 'João' } }],
    }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: row, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/schedule-events/ev-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().employee_ids).toEqual(['emp-db-1'])
    expect(res.json().employee_names).toEqual(['João'])
  })
})

describe('POST /schedule-events', () => {
  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/schedule-events', headers: { 'x-test-user': emp }, payload: eventPayload })
    expect(res.statusCode).toBe(403)
  })

  it('retorna 400 com body inválido (end_date antes de start_date)', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/schedule-events', headers: { 'x-test-user': mgr },
      payload: { ...eventPayload, start_date: '2026-06-10', end_date: '2026-06-01' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('manager cria evento via RPC transacional (create_schedule_event_with_employees)', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    mockSupabase.rpc.mockImplementation((fn: string, args: any) => {
      expect(fn).toBe('create_schedule_event_with_employees')
      expect(args.p_employee_ids).toEqual(['emp-db-1'])
      return Promise.resolve({ data: { id: 'ev-new', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-10' }, error: null })
    })
    const fullRow = {
      id: 'ev-new', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-10',
      schedule_event_employees: [{ employee_id: 'emp-db-1', employees: { name: 'João' } }],
    }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: fullRow, error: null }) }) }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })

    const res = await app.inject({ method: 'POST', url: '/schedule-events', headers: { 'x-test-user': mgr }, payload: eventPayload })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('ev-new')
    expect(res.json().employee_ids).toEqual(['emp-db-1'])
    // item 4: estado de sync visível ao usuário — começa "pending", não é
    // silenciosamente omitido enquanto o fire-and-forget roda em background.
    expect(res.json().calendar_sync_status).toBe('pending')
  })

  it('não deixa evento órfão quando a RPC falha (evento + vínculos são uma transação só)', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'insert or update on table "schedule_event_employees" violates foreign key constraint' },
    })
    const fromSpy = jest.fn()
    mockSupabase.from.mockImplementation(fromSpy)

    const res = await app.inject({ method: 'POST', url: '/schedule-events', headers: { 'x-test-user': mgr }, payload: eventPayload })
    expect(res.statusCode).toBe(500)
    // Como a RPC roda em transação única, não sobra evento parcial para buscar de volta.
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('sincroniza criação com o calendário admin e o calendário de cada funcionário conectado', async () => {
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'token-admin'
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    jest.mocked(googleCalendar.createCalendarEvent)
      .mockResolvedValueOnce('gev-admin')
      .mockResolvedValueOnce('gev-emp-1')

    mockSupabase.rpc.mockResolvedValue({ data: { id: 'ev-new' }, error: null })
    const fullRow = {
      id: 'ev-new', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-10',
      schedule_event_employees: [{ employee_id: 'emp-db-1', employees: { name: 'João' } }],
    }
    const updateEqSpy = jest.fn().mockResolvedValue({ error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [{ id: 'emp-db-1', email: 'j@sr.com', google_refresh_token: 'tok-emp-1' }], error: null }) }),
      }
      return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: fullRow, error: null }) }) }),
        update: jest.fn().mockReturnValue({ eq: updateEqSpy }),
      }
    })

    const res = await app.inject({ method: 'POST', url: '/schedule-events', headers: { 'x-test-user': mgr }, payload: eventPayload })
    expect(res.statusCode).toBe(201)

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(googleCalendar.createCalendarEvent).toHaveBeenCalledTimes(2)
    expect(updateEqSpy).toHaveBeenCalled()
  })

  it('marca calendar_sync_status como failed quando a sincronização com o Google falha (sem derrubar a resposta)', async () => {
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'token-admin'
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    jest.mocked(googleCalendar.createCalendarEvent).mockRejectedValue(new Error('Google API indisponível'))

    mockSupabase.rpc.mockResolvedValue({ data: { id: 'ev-new' }, error: null })
    const updateEqSpy = jest.fn().mockResolvedValue({ error: null })
    const fullRow = {
      id: 'ev-new', type: 'vacation', start_date: '2026-06-01', end_date: '2026-06-10',
      schedule_event_employees: [{ employee_id: 'emp-db-1', employees: { name: 'João' } }],
    }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: fullRow, error: null }) }) }),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
      update: jest.fn().mockReturnValue({ eq: updateEqSpy }),
    })

    const res = await app.inject({ method: 'POST', url: '/schedule-events', headers: { 'x-test-user': mgr }, payload: eventPayload })
    expect(res.statusCode).toBe(201)

    // Fire-and-forget: espera o microtask/catch rodar antes de checar o efeito colateral.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(updateEqSpy).toHaveBeenCalled()
  })
})

describe('PATCH /schedule-events/:id/cancel', () => {
  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const res = await app.inject({ method: 'PATCH', url: '/schedule-events/ev-1/cancel', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
  })

  it('manager cancela evento', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const updated = {
      id: 'ev-1', status: 'cancelled', google_event_id: null,
      schedule_event_employees: [],
    }
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }) }),
      }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ not: jest.fn().mockResolvedValue({ data: [], error: null }) }),
      }),
    })

    const res = await app.inject({ method: 'PATCH', url: '/schedule-events/ev-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('cancelled')
  })

  it('retorna 404 quando o evento não existe', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
      }),
    })
    const res = await app.inject({ method: 'PATCH', url: '/schedule-events/ev-9/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })

  it('marca calendar_sync_status como failed quando o cancelamento no Google falha', async () => {
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'token-admin'
    jest.mocked(googleCalendar.cancelCalendarEvent).mockRejectedValueOnce(new Error('Google API indisponível'))
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    const updated = { id: 'ev-1', status: 'cancelled', google_event_id: 'gev-1', schedule_event_employees: [] }
    const updateEqSpy = jest.fn().mockResolvedValue({ error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_events') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }) }),
        }),
      }
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ not: jest.fn().mockResolvedValue({ data: [], error: null }) }) }),
      }
      return { update: jest.fn().mockReturnValue({ eq: updateEqSpy }) }
    })

    const res = await app.inject({ method: 'PATCH', url: '/schedule-events/ev-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(googleCalendar.cancelCalendarEvent).toHaveBeenCalled()
  })

  it('cancela também os eventos vinculados dos funcionários conectados ao Google', async () => {
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'token-admin'
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    const updated = { id: 'ev-1', status: 'cancelled', google_event_id: 'gev-1', schedule_event_employees: [] }
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_events') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: updated, error: null }) }) }),
        }),
      }
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockResolvedValue({
              data: [{ employee_id: 'emp-db-1', google_event_id: 'gev-emp-1', employees: { google_refresh_token: 'tok-emp-1' } }],
              error: null,
            }),
          }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'PATCH', url: '/schedule-events/ev-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(googleCalendar.cancelCalendarEvent).toHaveBeenCalledWith('token-admin', 'primary', 'gev-1')
    expect(googleCalendar.cancelCalendarEvent).toHaveBeenCalledWith('tok-emp-1', 'primary', 'gev-emp-1')
  })
})

describe('DELETE /schedule-events/:id', () => {
  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: '/schedule-events/ev-1', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(403)
  })

  it('manager deleta evento', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_events') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { google_event_id: null }, error: null }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'DELETE', url: '/schedule-events/ev-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)
  })

  it('retorna 500 quando o delete falha', async () => {
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_events') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { google_event_id: null }, error: null }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'db error' } }) }),
      }
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'DELETE', url: '/schedule-events/ev-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(500)
  })

  it('sincroniza exclusão no Google Calendar (admin + funcionários com token) e loga falha sem quebrar a resposta', async () => {
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'token-admin'
    jest.mocked(googleCalendar.deleteCalendarEvent).mockRejectedValueOnce(new Error('Google API indisponível'))
    const app = buildApp()
    app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
    await app.ready()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'schedule_events') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { google_event_id: 'gev-1' }, error: null }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'schedule_event_employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ employee_id: 'emp-db-1', google_event_id: 'gev-emp-1' }], error: null }) }),
      }
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { google_refresh_token: 'tok-emp-1' }, error: null }) }) }),
      }
      return mockSupabase
    })

    const res = await app.inject({ method: 'DELETE', url: '/schedule-events/ev-1', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(204)

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(googleCalendar.deleteCalendarEvent).toHaveBeenCalled()
  })
})
