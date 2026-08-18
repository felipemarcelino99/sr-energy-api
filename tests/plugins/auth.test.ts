import Fastify from 'fastify'
import authPlugin from '@/plugins/auth'

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

let userCounter = 0

// item 6: roleCache é um Map em escopo de módulo (singleton do plugin) — usar
// um userId único por teste evita que o cache de um teste vaze para o
// próximo (o módulo só é carregado uma vez para todo o arquivo de teste).
function buildAuthApp() {
  const userId = `u-${++userCounter}`
  const app = Fastify({ logger: false })
  const single = jest.fn().mockResolvedValue({ data: { role: 'manager' }, error: null })
  const eq = jest.fn().mockReturnValue({ single })
  const select = jest.fn().mockReturnValue({ eq })
  const from = jest.fn().mockReturnValue({ select })
  const getUser = jest.fn().mockResolvedValue({
    data: { user: { id: userId, email: 'u@sr.com', user_metadata: { name: 'User' } } },
    error: null,
  })
  const supabase = { from, auth: { getUser } }
  app.decorate('supabase', supabase as any)
  app.register(authPlugin)
  app.get('/protected', { onRequest: [(req: any) => (app as any).authenticate(req)] }, async (req: any) => req.user)
  return { app, from, getUser, single }
}

describe('auth plugin', () => {
  it('rejeita requisição sem Authorization header', async () => {
    const { app } = buildAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
  })

  it('rejeita token com aud diferente de "authenticated"', async () => {
    const { app } = buildAuthApp()
    await app.ready()
    const token = makeToken({ aud: 'anon' })
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })

  it('rejeita token malformado (payload não decodificável)', async () => {
    const { app } = buildAuthApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Bearer not.a.jwt!!!' } })
    expect(res.statusCode).toBe(401)
  })

  it('rejeita quando supabase.auth.getUser falha', async () => {
    const { app, getUser } = buildAuthApp()
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } })
    await app.ready()
    const token = makeToken({ aud: 'authenticated' })
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })

  it('busca role em user_roles e retorna req.user preenchido', async () => {
    const { app } = buildAuthApp()
    await app.ready()
    const token = makeToken({ aud: 'authenticated' })
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ email: 'u@sr.com', role: 'manager', name: 'User' })
  })

  it('usa "employee" como fallback quando não há linha em user_roles', async () => {
    const { app, single } = buildAuthApp()
    single.mockResolvedValueOnce({ data: null, error: null })
    await app.ready()
    const token = makeToken({ aud: 'authenticated' })
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().role).toBe('employee')
  })

  it('item 6: cacheia a role e não bate em user_roles na segunda requisição do mesmo usuário', async () => {
    const { app, from } = buildAuthApp()
    await app.ready()
    const token = makeToken({ aud: 'authenticated' })

    const res1 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res1.statusCode).toBe(200)
    expect(from).toHaveBeenCalledWith('user_roles')
    const callsAfterFirst = from.mock.calls.filter((c) => c[0] === 'user_roles').length
    expect(callsAfterFirst).toBe(1)

    const res2 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(res2.statusCode).toBe(200)
    const callsAfterSecond = from.mock.calls.filter((c) => c[0] === 'user_roles').length
    // Segunda requisição do mesmo usuário não bate no banco de novo — veio do cache.
    expect(callsAfterSecond).toBe(1)
  })

  it('item 6: expira o cache após o TTL e busca a role de novo', async () => {
    const { app, from } = buildAuthApp()
    await app.ready()
    const token = makeToken({ aud: 'authenticated' })

    const realNow = Date.now.bind(Date)
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow())

    await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(from.mock.calls.filter((c) => c[0] === 'user_roles').length).toBe(1)

    // Avança o relógio além do TTL (60s) sem usar fake timers do Fastify —
    // só o Date.now() consultado pelo cache de role é adiantado.
    nowSpy.mockImplementation(() => realNow() + 60_001)

    await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } })
    expect(from.mock.calls.filter((c) => c[0] === 'user_roles').length).toBe(2)
    nowSpy.mockRestore()
  })
})
