import { buildApp, mockSupabase } from '../helpers/build-app'
import chatRoute from '@/routes/chat'
import * as ragService from '@/services/rag.service'
import * as curatedService from '@/services/rag.curated.service'

jest.mock('@/services/rag.service')
jest.mock('@/services/rag.curated.service')

const admin = JSON.stringify({ id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })

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

describe('POST /chat/compare', () => {
  it('returns comparative answer', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    jest.mocked(ragService.compareAcrossMachines).mockResolvedValue('Máquina A é mais eficiente.')
    const res = await app.inject({
      method: 'POST', url: '/chat/compare',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineIds: ['m1', 'm2'], message: 'Qual é mais eficiente?' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answer).toBe('Máquina A é mais eficiente.')
  })

  it('returns 400 when fewer than 2 machineIds', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/chat/compare',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineIds: ['m1'], message: 'Pergunta?' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /chat/curate', () => {
  it('saves curated answer and returns 201', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    jest.mocked(ragService.embedTexts).mockResolvedValue([Array(1024).fill(0.1)])
    jest.mocked(curatedService.saveCuratedAnswer).mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'POST', url: '/chat/curate',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machineId: 'machine-1', question: 'Pergunta?', answer: 'Resposta.' },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('DELETE /chat/curate/:id', () => {
  it('deletes curated answer as admin', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    jest.mocked(curatedService.deleteCuratedAnswer).mockResolvedValue(undefined)
    const res = await app.inject({
      method: 'DELETE', url: '/chat/curate/answer-1',
      headers: { 'x-test-user': admin },
    })
    expect(res.statusCode).toBe(204)
  })

  it('returns 403 for non-admin', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    const res = await app.inject({
      method: 'DELETE', url: '/chat/curate/answer-1',
      headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(403)
  })
})
