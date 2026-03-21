import { buildApp, mockSupabase } from '../helpers/build-app'
import jobsRoute from '@/routes/jobs'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })

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

describe('PATCH /jobs/:id/cancel', () => {
  it('muda status para cancelled', async () => {
    const app = buildApp()
    app.register(jobsRoute, { prefix: '/jobs' })
    await app.ready()
    const updated = { id: 'j-1', status: 'cancelled' }
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      }),
    })
    const res = await app.inject({ method: 'PATCH', url: '/jobs/j-1/cancel', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('cancelled')
  })
})
