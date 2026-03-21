import { buildApp, mockSupabase } from '../helpers/build-app'
import machinesRoute from '@/routes/machines'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('GET /machines', () => {
  it('retorna lista', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const rows = [{ id: 'm-1', name: 'TR-500' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /machines/:id/jobs', () => {
  it('retorna histórico de trabalhos da máquina', async () => {
    const app = buildApp()
    app.register(machinesRoute, { prefix: '/machines' })
    await app.ready()
    const jobs = [{ id: 'j-1', employee_name: 'João', scheduled_date: '2026-03-10' }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: jobs, error: null }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/machines/m-1/jobs', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(jobs)
  })
})
