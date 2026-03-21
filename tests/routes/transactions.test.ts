import { buildApp, mockSupabase } from '../helpers/build-app'
import transactionsRoute from '@/routes/transactions'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })

describe('POST /transactions', () => {
  it('rejeita amount <= 0', async () => {
    const app = buildApp()
    app.register(transactionsRoute, { prefix: '/transactions' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/transactions',
      headers: { 'x-test-user': mgr, 'content-type': 'application/json' },
      payload: { type: 'credit', amount: -100, description: 'test', category: 'cat', date: '2026-03-01' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('cria transação e retorna 201', async () => {
    const app = buildApp()
    app.register(transactionsRoute, { prefix: '/transactions' })
    await app.ready()
    const tx = { id: 'tx-1', type: 'credit', amount: 1000 }
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: tx, error: null }),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST', url: '/transactions',
      headers: { 'x-test-user': mgr, 'content-type': 'application/json' },
      payload: { type: 'credit', amount: 1000, description: 'Pagamento', category: 'Serviços', date: '2026-03-01' },
    })
    expect(res.statusCode).toBe(201)
  })
})
