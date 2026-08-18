import { buildApp, mockSupabase } from '../helpers/build-app'
import chatRoute from '@/routes/chat'
import * as ragService from '@/services/rag.service'
import * as curatedService from '@/services/rag.curated.service'

jest.mock('@/services/rag.service')
jest.mock('@/services/rag.curated.service')

const admin = JSON.stringify({ id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })

const emp = JSON.stringify({ id: 'user-1', role: 'employee', name: 'João', email: 'j@sr.com' })

function mockMachinesExist(ids: string[]) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'machines') return {
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: ids.map((id) => ({ id })), error: null }),
      }),
    }
    return mockSupabase
  })
}

beforeEach(() => jest.clearAllMocks())

describe('POST /chat', () => {
  it('retorna resposta da IA', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()

    mockMachinesExist(['machine-1'])
    jest.mocked(ragService.answerQuestion).mockResolvedValue('O óleo deve ser trocado a cada 500h.')

    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_id: 'machine-1', message: 'Qual a frequência de troca de óleo?' },
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
      payload: { machine_id: '', message: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 404 quando o erro do RAG indica manual não indexado', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    mockMachinesExist(['machine-1'])
    jest.mocked(ragService.answerQuestion).mockRejectedValue(new Error('Manual não indexado para esta máquina'))
    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_id: 'machine-1', message: 'Pergunta?' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('retorna 502 quando o RAG falha genericamente', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    mockMachinesExist(['machine-1'])
    jest.mocked(ragService.answerQuestion).mockRejectedValue(new Error('timeout'))
    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_id: 'machine-1', message: 'Pergunta?' },
    })
    expect(res.statusCode).toBe(502)
  })

  it('retorna 404 quando machine_id não existe (MED-08)', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    mockMachinesExist([]) // nenhuma máquina encontrada
    const res = await app.inject({
      method: 'POST', url: '/chat',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_id: 'machine-inexistente', message: 'Pergunta?' },
    })
    expect(res.statusCode).toBe(404)
    expect(ragService.answerQuestion).not.toHaveBeenCalled()
  })
})

describe('POST /chat/compare', () => {
  it('returns comparative answer', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    mockMachinesExist(['m1', 'm2'])
    jest.mocked(ragService.compareAcrossMachines).mockResolvedValue('Máquina A é mais eficiente.')
    const res = await app.inject({
      method: 'POST', url: '/chat/compare',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_ids: ['m1', 'm2'], message: 'Qual é mais eficiente?' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().answer).toBe('Máquina A é mais eficiente.')
  })

  it('returns 502 when compareAcrossMachines fails', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    mockMachinesExist(['m1', 'm2'])
    jest.mocked(ragService.compareAcrossMachines).mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'POST', url: '/chat/compare',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_ids: ['m1', 'm2'], message: 'Pergunta?' },
    })
    expect(res.statusCode).toBe(502)
  })

  it('returns 400 when fewer than 2 machineIds', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    const res = await app.inject({
      method: 'POST', url: '/chat/compare',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_ids: ['m1'], message: 'Pergunta?' },
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
      payload: { machine_id: 'machine-1', question: 'Pergunta?', answer: 'Resposta.' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('retorna 500 quando falha ao salvar resposta curada', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    jest.mocked(ragService.embedTexts).mockRejectedValue(new Error('embed failed'))
    const res = await app.inject({
      method: 'POST', url: '/chat/curate',
      headers: { 'x-test-user': emp, 'content-type': 'application/json' },
      payload: { machine_id: 'machine-1', question: 'Pergunta?', answer: 'Resposta.' },
    })
    expect(res.statusCode).toBe(500)
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

  it('retorna 500 quando falha ao remover resposta', async () => {
    const app = buildApp()
    app.register(chatRoute, { prefix: '/chat' })
    await app.ready()
    jest.mocked(curatedService.deleteCuratedAnswer).mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'DELETE', url: '/chat/curate/answer-1',
      headers: { 'x-test-user': admin },
    })
    expect(res.statusCode).toBe(500)
  })
})
