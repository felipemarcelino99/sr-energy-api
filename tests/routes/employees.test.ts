import { buildApp, mockSupabase } from '../helpers/build-app'
import employeesRoute from '@/routes/employees'

const managerUser = JSON.stringify({ id: 'mgr-1', email: 'mgr@sr.com', role: 'manager', name: 'Mgr' })
const employeeUser = JSON.stringify({ id: 'emp-user-1', email: 'emp@sr.com', role: 'employee', name: 'Emp' })

beforeEach(() => jest.clearAllMocks())

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

  it('HIGH-04: employee não recebe coluna salary no payload', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    let selectedColumns = ''
    const rows = [{ id: 'emp-1', name: 'João', email: 'joao@sr.com' }] // sem salary
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockImplementation((columns: string) => {
        selectedColumns = columns
        return { order: jest.fn().mockResolvedValue({ data: rows, error: null }) }
      }),
    })

    const res = await app.inject({
      method: 'GET', url: '/employees',
      headers: { 'x-test-user': employeeUser },
    })
    expect(res.statusCode).toBe(200)
    expect(selectedColumns).not.toContain('salary')
    expect(res.json()[0].salary).toBeUndefined()
  })
})

describe('GET /employees/:id', () => {
  it('HIGH-04: employee não recebe salary de outro colaborador', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    let selectedColumns = ''
    const row = { id: '11111111-1111-1111-1111-111111111111', name: 'Maria', email: 'maria@sr.com' }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockImplementation((columns: string) => {
        selectedColumns = columns
        return { eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: row, error: null }) }) }
      }),
    })

    const res = await app.inject({
      method: 'GET', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': employeeUser },
    })
    expect(res.statusCode).toBe(200)
    expect(selectedColumns).not.toContain('salary')
    expect(res.json().salary).toBeUndefined()
  })

  it('manager continua recebendo salary', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    let selectedColumns = ''
    const row = { id: '11111111-1111-1111-1111-111111111111', name: 'Maria', email: 'maria@sr.com', salary: 6000 }
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockImplementation((columns: string) => {
        selectedColumns = columns
        return { eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: row, error: null }) }) }
      }),
    })

    const res = await app.inject({
      method: 'GET', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': managerUser },
    })
    expect(res.statusCode).toBe(200)
    expect(selectedColumns).toContain('salary')
    expect(res.json().salary).toBe(6000)
  })
})

describe('POST /employees', () => {
  it('cria funcionário com a senha enviada pelo admin (CRITICAL-03: nunca fixa/gerada pelo servidor) e retorna 201', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()

    const password = 'Str0ng!Passw0rd42'
    const body = { name: 'Maria', email: 'maria@sr.com', phone: '11999990001',
      role: 'employee', salary: 5000, hired_at: '2024-01-01', password }
    const created = { id: 'emp-new', name: body.name, email: body.email, phone: body.phone,
      role: body.role, salary: body.salary, hired_at: body.hired_at }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: created, error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'user_roles') return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      }
      return mockSupabase
    })
    mockSupabase.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'user-new' } }, error: null,
    })

    const res = await app.inject({
      method: 'POST', url: '/employees',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('emp-new')

    const createUserCall = mockSupabase.auth.admin.createUser.mock.calls[0][0]
    expect(createUserCall.password).toBe(password)
    expect(createUserCall.user_metadata.must_change_password).toBe(true)
    expect(res.json().password).toBeUndefined()
  })

  it('employee recebe 403 ao tentar criar funcionário', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/employees',
      headers: { 'x-test-user': employeeUser, 'content-type': 'application/json' },
      payload: { name: 'X', email: 'x@sr.com', phone: '11999990001', role: 'employee', salary: 1000, hired_at: '2024-01-01' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('retorna funcionário sem user_id quando criação no Auth falha', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const body = { name: 'Maria', email: 'maria@sr.com', phone: '11999990001',
      role: 'employee', salary: 5000, hired_at: '2024-01-01', password: 'Str0ng!Passw0rd42' }
    const created = { id: 'emp-new', name: body.name, email: body.email, phone: body.phone,
      role: body.role, salary: body.salary, hired_at: body.hired_at }
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: created, error: null }) }),
      }),
    })
    mockSupabase.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'fail' } })
    const res = await app.inject({
      method: 'POST', url: '/employees',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user_id).toBeUndefined()
  })
})

describe('PUT /employees/:id', () => {
  it('manager atualiza funcionário', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const body = { name: 'Maria', email: 'maria@sr.com', phone: '11999990001',
      role: 'employee', salary: 5500, hired_at: '2024-01-01' }
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'emp-1', ...body }, error: null }) }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'PUT', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
  })

  it('employee recebe 403', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const res = await app.inject({
      method: 'PUT', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': employeeUser, 'content-type': 'application/json' },
      payload: { name: 'X', email: 'x@sr.com', phone: '11999990001', role: 'employee', salary: 1000, hired_at: '2024-01-01' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /employees/:id', () => {
  it('admin deleta funcionário', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const admin = JSON.stringify({ id: 'adm-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })
    mockSupabase.from.mockReturnValue({
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })
    const res = await app.inject({
      method: 'DELETE', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': admin },
    })
    expect(res.statusCode).toBe(204)
  })

  it('manager recebe 403 (só admin pode deletar)', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    const res = await app.inject({
      method: 'DELETE', url: '/employees/11111111-1111-1111-1111-111111111111',
      headers: { 'x-test-user': managerUser },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET/POST /employees/:id/salary-adjustments', () => {
  it('manager lista ajustes salariais', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: [{ id: 'adj-1' }], error: null }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: '/employees/11111111-1111-1111-1111-111111111111/salary-adjustments',
      headers: { 'x-test-user': managerUser },
    })
    expect(res.statusCode).toBe(200)
  })

  it('manager registra ajuste salarial', async () => {
    const app = buildApp()
    app.register(employeesRoute, { prefix: '/employees' })
    await app.ready()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { salary: 5000 }, error: null }) }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'salary_adjustments') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'adj-1', new_salary: 6000 }, error: null }) }),
        }),
      }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'POST', url: '/employees/11111111-1111-1111-1111-111111111111/salary-adjustments',
      headers: { 'x-test-user': managerUser, 'content-type': 'application/json' },
      payload: { new_salary: 6000, reason: 'Reajuste anual' },
    })
    expect(res.statusCode).toBe(201)
  })
})
