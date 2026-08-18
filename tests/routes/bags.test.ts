import multipart from '@fastify/multipart'
import { buildApp, mockSupabase } from '../helpers/build-app'
import bagsRoute from '@/routes/bags'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })
const validUuid = 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd'

beforeEach(() => jest.clearAllMocks())

function pdfPart() {
  // %PDF magic bytes — passa em detectMimeFromBuffer()
  return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
}

// Monta um corpo multipart/form-data real (fastify.inject não faz parsing de
// objeto JS como multipart — precisa do encoding de verdade para @fastify/multipart
// conseguir interpretar as partes via req.parts()).
function buildMultipartPayload(
  fileContent: Buffer,
  filename: string,
  mimetype: string,
  expiryDate: string | null,
) {
  const boundary = '----testBoundary123456'
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    ),
    fileContent,
    Buffer.from('\r\n'),
  ]
  if (expiryDate !== null) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="expiryDate"\r\n\r\n${expiryDate}\r\n`,
      ),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  }
}

async function buildBagsApp() {
  const app = buildApp()
  await app.register(multipart)
  app.register(bagsRoute, { prefix: '/bags' })
  await app.ready()
  return app
}

describe('GET /bags', () => {
  it('retorna lista de bags', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: [{ id: 'b-1' }], error: null }) }),
    })
    const res = await app.inject({ method: 'GET', url: '/bags', headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('POST /bags', () => {
  it('employee recebe 403', async () => {
    const app = await buildBagsApp()
    const res = await app.inject({
      method: 'POST', url: '/bags', headers: { 'x-test-user': emp },
      payload: { name: 'Mala 1', model: 'M1', quantity: 1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('manager cria bag', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'b-1' }, error: null }) }) }),
    })
    const res = await app.inject({
      method: 'POST', url: '/bags', headers: { 'x-test-user': mgr },
      payload: { name: 'Mala 1', model: 'M1', quantity: 1 },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('POST /bags/:id/certificates', () => {
  it('faz upload e insere certificado com sucesso', async () => {
    const app = await buildBagsApp()
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/cert.pdf' }, error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'calibration_certificates') return { insert: jest.fn().mockResolvedValue({ error: null }) }
      if (table === 'bags') return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: validUuid }, error: null }) }) }),
      }
      return mockSupabase
    })

    const { contentType, body } = buildMultipartPayload(pdfPart(), 'cert.pdf', 'application/pdf', '2027-01-01')
    const res = await app.inject({
      method: 'POST',
      url: `/bags/${validUuid}/certificates`,
      headers: { 'x-test-user': mgr, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
  })

  it('remove o arquivo órfão do storage quando o insert no banco falha (compensação)', async () => {
    const app = await buildBagsApp()
    const removeSpy = jest.fn().mockResolvedValue({ error: null })
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/cert.pdf' }, error: null }),
      remove: removeSpy,
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'calibration_certificates') return { insert: jest.fn().mockResolvedValue({ error: { message: 'insert failed' } }) }
      return mockSupabase
    })

    const { contentType, body } = buildMultipartPayload(pdfPart(), 'cert.pdf', 'application/pdf', '2027-01-01')
    const res = await app.inject({
      method: 'POST',
      url: `/bags/${validUuid}/certificates`,
      headers: { 'x-test-user': mgr, 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(500)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    const [removedPaths] = removeSpy.mock.calls[0]
    expect(removedPaths).toHaveLength(1)
    expect(removedPaths[0]).toMatch(new RegExp(`^${validUuid}/.+\\.pdf$`))
  })

  it('rejeita arquivo com tipo não permitido (magic bytes)', async () => {
    const app = await buildBagsApp()
    const { contentType, body } = buildMultipartPayload(Buffer.from('not a real file'), 'cert.txt', 'text/plain', '2027-01-01')
    const res = await app.inject({
      method: 'POST',
      url: `/bags/${validUuid}/certificates`,
      headers: { 'x-test-user': mgr, 'content-type': contentType },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando arquivo não é enviado', async () => {
    const app = await buildBagsApp()
    const boundary = '----testBoundary123456'
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="expiryDate"\r\n\r\n2027-01-01\r\n--${boundary}--\r\n`,
    )
    const res = await app.inject({
      method: 'POST',
      url: `/bags/${validUuid}/certificates`,
      headers: { 'x-test-user': mgr, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando expiryDate não é enviado', async () => {
    const app = await buildBagsApp()
    const boundary = '----testBoundary123456'
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cert.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    )
    const body = Buffer.concat([head, pdfPart(), Buffer.from(`\r\n--${boundary}--\r\n`)])
    const res = await app.inject({
      method: 'POST',
      url: `/bags/${validUuid}/certificates`,
      headers: { 'x-test-user': mgr, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /bags/:id', () => {
  it('retorna bag por id', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: validUuid }, error: null }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/bags/${validUuid}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando não encontrado', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }),
    })
    const res = await app.inject({ method: 'GET', url: `/bags/${validUuid}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /bags/:id', () => {
  it('employee recebe 403', async () => {
    const app = await buildBagsApp()
    const res = await app.inject({
      method: 'PUT', url: `/bags/${validUuid}`, headers: { 'x-test-user': emp },
      payload: { name: 'Mala 1', model: 'M1', quantity: 1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('manager atualiza bag', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: validUuid }, error: null }) }) }) }),
    })
    const res = await app.inject({
      method: 'PUT', url: `/bags/${validUuid}`, headers: { 'x-test-user': mgr },
      payload: { name: 'Mala 1', model: 'M1', quantity: 2 },
    })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando bag não existe', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }) }),
    })
    const res = await app.inject({
      method: 'PUT', url: `/bags/${validUuid}`, headers: { 'x-test-user': mgr },
      payload: { name: 'Mala 1', model: 'M1', quantity: 2 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /bags/:id', () => {
  it('manager recebe 403 (só admin)', async () => {
    const app = await buildBagsApp()
    const res = await app.inject({ method: 'DELETE', url: `/bags/${validUuid}`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(403)
  })

  it('admin deleta bag', async () => {
    const app = await buildBagsApp()
    const admin = JSON.stringify({ id: 'admin-1', role: 'admin', name: 'Admin', email: 'a@sr.com' })
    mockSupabase.from.mockReturnValue({
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    })
    const res = await app.inject({ method: 'DELETE', url: `/bags/${validUuid}`, headers: { 'x-test-user': admin } })
    expect(res.statusCode).toBe(204)
  })
})

describe('DELETE /bags/:id/certificates/:certId', () => {
  it('remove certificado e retorna bag atualizada', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'calibration_certificates') return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }) }
      if (table === 'bags') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: validUuid }, error: null }) }) }) }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/bags/${validUuid}/certificates/${validUuid}`,
      headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(200)
  })

  it('retorna 404 quando bag não existe mais após remoção', async () => {
    const app = await buildBagsApp()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'calibration_certificates') return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }) }
      if (table === 'bags') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) }) }
      return mockSupabase
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/bags/${validUuid}/certificates/${validUuid}`,
      headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(404)
  })
})
