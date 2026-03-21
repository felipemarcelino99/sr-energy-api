import { buildApp, mockSupabase } from '../helpers/build-app'
import chatRoute from '@/routes/chat'
import * as ragService from '@/services/rag.service'

jest.mock('@/services/rag.service')

const emp = JSON.stringify({ id: 'user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

describe('POST /chat', () => {
  it('retorna resposta da IA', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()

    jest.mocked(ragService.answerQuestion).mockResolvedValue('O óleo deve ser trocado a cada 500h.')

    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineId: 'machine-1', message: 'Qual a frequência de troca de óleo?' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answer).toBe('O óleo deve ser trocado a cada 500h.')
  })

  it('retorna 400 para payload inválido', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineId: '', message: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})
