import { buildApp, mockSupabase } from '../helpers/build-app'
import contractsRoute from '@/routes/contracts'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('GET /contracts/expiring', () => {
  it('retorna contratos que vencem nos próximos 30 dias', async () => {
    const app = buildApp()
    app.register(contractsRoute, { prefix: '/contracts' })
    await app.ready()

    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const rows = [{ id: 'c-1', client_name: 'ABC', end_date: in30 }]
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/contracts/expiring', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})
