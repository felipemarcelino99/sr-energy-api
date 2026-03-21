import { buildApp, mockSupabase } from '../helpers/build-app'
import reportsRoute from '@/routes/reports'

const emp = JSON.stringify({ id: 'emp-user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('POST /jobs/:id/report', () => {
  it('cria relatório e muda status do job para completed', async () => {
    const app = buildApp()
    app.register(reportsRoute)
    await app.ready()

    // Mock: buscar employee pelo user_id
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'emp-db-1' }, error: null }),
          }),
        }),
      }
      if (table === 'job_reports') return {
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'rpt-1', job_id: 'j-1', content: '<p>ok</p>' }, error: null }),
          }),
        }),
      }
      if (table === 'jobs') return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }
      return mockSupabase
    })

    const res = await app.inject({
      method: 'POST', url: '/jobs/j-1/report',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { content: '<p>Relatório ok</p>' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('rpt-1')
  })
})
