import { buildApp, mockSupabase } from '../helpers/build-app'
import employeesRoute from '@/routes/employees'

const managerUser = JSON.stringify({ id: 'mgr-1', email: 'mgr@sr.com', role: 'manager', name: 'Mgr' })

describe('GET /employees', () => {
  it('retorna lista de funcionários', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    const rows = [{ id: 'emp-1', name: 'João', email: 'joao@sr.com' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })

    const res = await app.inject({
      method: 'GET', url: '/employees',
      headers: { 'x-test-user': managerUser },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(rows)
  })
})

describe('POST /employees', () => {
  it('cria funcionário e retorna 201', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    const body = { name: 'Maria', email: 'maria@sr.com', phone: '11999990001',
      role: 'employee', salary: 5000, hired_at: '2024-01-01' }
    const created = { id: 'emp-new', ...body }

    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: created, error: null }),
        }),
      }),
    })

    const res = await app.inject({
      method: 'POST', url: '/employees',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('emp-new')
  })
})
