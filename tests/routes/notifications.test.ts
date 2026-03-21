import { buildApp, mockSupabase } from '../helpers/build-app'
import notificationsRoute from '@/routes/notifications'

const emp = JSON.stringify({ id: 'user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('PATCH /notifications/read-all', () => {
  it('marca todas como lidas', async () => {
    const app = buildApp()
    app.register(notificationsRoute, { prefix: '/notifications' })
    await app.ready()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })
    const res = await app.inject({ method: 'PATCH', url: '/notifications/read-all', headers: { 'x-test-user': emp } })
    expect(res.statusCode).toBe(204)
  })
})
