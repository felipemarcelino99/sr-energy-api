import multipart from '@fastify/multipart'
import { buildApp, mockSupabase } from '../helpers/build-app'
import documentsRoute from '@/routes/documents'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })
const jobId = 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd'

beforeEach(() => jest.clearAllMocks())
afterEach(() => mockSupabase.from.mockReturnThis())

async function buildDocumentsApp() {
  const app = buildApp()
  await app.register(multipart)
  app.register(documentsRoute, { prefix: '/documents' })
  await app.ready()
  return app
}

function pdfBytes() {
  return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
}

function buildMultipartPayload(fields: Record<string, string>) {
  const boundary = '----testBoundary123456'
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="relatorio.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    pdfBytes(),
    Buffer.from('\r\n'),
  ]
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) }
}

describe('GET /documents', () => {
  it('lista documentos por entityType/entityId', async () => {
    const app = await buildDocumentsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [{ id: 'doc-1' }], error: null }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: `/documents?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('400 quando entityType é inválido', async () => {
    const app = await buildDocumentsApp()
    const res = await app.inject({
      method: 'GET', url: `/documents?entityType=invalid&entityId=${jobId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /documents', () => {
  it('manager anexa PDF nativo — sobe no storage e insere em documents', async () => {
    const app = await buildDocumentsApp()
    const uploadMock = jest.fn().mockResolvedValue({ error: null, data: { path: 'x' } })
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null })
    mockSupabase.storage.from.mockReturnValue({ upload: uploadMock, createSignedUrl })
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'doc-1', storage_kind: 'internal' }, error: null }),
        }),
      }),
    })

    const { contentType, body } = buildMultipartPayload({ entityType: 'job', entityId: jobId })
    const res = await app.inject({
      method: 'POST', url: '/documents', headers: { 'x-test-user': mgr, 'content-type': contentType }, payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(uploadMock).toHaveBeenCalled()
  })

  it('R-FUP.4: nome de arquivo com path traversal não vira parte do path do storage', async () => {
    const app = await buildDocumentsApp()
    const uploadMock = jest.fn().mockResolvedValue({ error: null, data: { path: 'x' } })
    mockSupabase.storage.from.mockReturnValue({
      upload: uploadMock,
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null }),
    })
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'doc-1', storage_kind: 'internal' }, error: null }),
        }),
      }),
    })

    const boundary = '----testBoundary123456'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../../../etc/passwd.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfBytes(),
      Buffer.from('\r\n'),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\njob\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${jobId}\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    const res = await app.inject({
      method: 'POST', url: '/documents',
      headers: { 'x-test-user': mgr, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    const usedPath = uploadMock.mock.calls[0][0] as string
    expect(usedPath).not.toContain('..')
    expect(usedPath.split('/')).toHaveLength(3) // entityType/entityId/arquivo — sem segmentos extras injetados
  })

  it('employee recebe 403 (só admin/manager anexam documento)', async () => {
    const app = await buildDocumentsApp()
    const { contentType, body } = buildMultipartPayload({ entityType: 'job', entityId: jobId })
    const res = await app.inject({
      method: 'POST', url: '/documents', headers: { 'x-test-user': emp, 'content-type': contentType }, payload: body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('400 quando arquivo não é PDF/JPEG/PNG (magic bytes não batem)', async () => {
    const app = await buildDocumentsApp()
    const boundary = '----testBoundary123456'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('not a real file'),
      Buffer.from('\r\n'),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entityType"\r\n\r\njob\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entityId"\r\n\r\n${jobId}\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    const res = await app.inject({
      method: 'POST', url: '/documents',
      headers: { 'x-test-user': mgr, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /documents/link-legacy', () => {
  it('manager vincula documento do Drive com note obrigatória', async () => {
    const app = await buildDocumentsApp()
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'doc-2', storage_kind: 'drive_link' }, error: null,
          }),
        }),
      }),
    })

    const res = await app.inject({
      method: 'POST', url: '/documents/link-legacy', headers: { 'x-test-user': mgr },
      payload: { entityType: 'contract', entityId: jobId, driveUrl: 'https://drive.google.com/x', note: 'acervo 2023' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('400 quando note não é enviada', async () => {
    const app = await buildDocumentsApp()
    const res = await app.inject({
      method: 'POST', url: '/documents/link-legacy', headers: { 'x-test-user': mgr },
      payload: { entityType: 'contract', entityId: jobId, driveUrl: 'https://drive.google.com/x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('employee recebe 403', async () => {
    const app = await buildDocumentsApp()
    const res = await app.inject({
      method: 'POST', url: '/documents/link-legacy', headers: { 'x-test-user': emp },
      payload: { entityType: 'contract', entityId: jobId, driveUrl: 'https://drive.google.com/x', note: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /documents — IDOR (employee só vê documento de job próprio)', () => {
  function mockEmployeeJobChain(opts: { employeeId?: string; jobEmployeeId?: string | null; linked?: boolean }) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: opts.employeeId ? { id: opts.employeeId } : null, error: null }) }) }) }
      }
      if (table === 'jobs') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: jobId, employee_id: opts.jobEmployeeId ?? null }, error: null }) }) }) }
      }
      if (table === 'job_employees') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.linked ? { job_id: jobId } : null, error: null }) }) }) }) }
      }
      if (table === 'documents') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'doc-1' }], error: null }) }) }) }) }
      }
      return {}
    })
  }

  it('404 quando o employee não está atribuído ao job (nem legado, nem job_employees)', async () => {
    const app = await buildDocumentsApp()
    mockEmployeeJobChain({ employeeId: 'emp-1', jobEmployeeId: 'other-emp', linked: false })

    const res = await app.inject({
      method: 'GET', url: `/documents?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(404)
  })

  it('200 quando o employee está atribuído ao job via job_employees', async () => {
    const app = await buildDocumentsApp()
    mockEmployeeJobChain({ employeeId: 'emp-1', jobEmployeeId: null, linked: true })

    const res = await app.inject({
      method: 'GET', url: `/documents?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
  })

  it('200 quando o employee é o assignee legado (employee_id)', async () => {
    const app = await buildDocumentsApp()
    mockEmployeeJobChain({ employeeId: 'emp-1', jobEmployeeId: 'emp-1', linked: false })

    const res = await app.inject({
      method: 'GET', url: `/documents?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /documents/generate-report/:id', () => {
  function mockJobAndReportChain(overrides: { job?: any; report?: any; employee?: any; contract?: any } = {}) {
    const job = 'job' in overrides ? overrides.job : {
      id: jobId, number: '26001', description: 'Manutenção', scheduled_date: '2026-08-20',
      city: 'SP', state: 'SP', employee_id: 'emp-1', contract_id: 'contract-1',
    }
    const report = 'report' in overrides ? overrides.report : { content: 'Tudo certo', evidences: [] }
    const employee = overrides.employee ?? { name: 'João' }
    const contract = overrides.contract ?? { clients: { razao_social: 'ACME' } }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'jobs') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: job, error: job ? null : { message: 'not found' } }) }) }) }
      }
      if (table === 'job_reports') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: report, error: report ? null : { message: 'not found' } }) }) }) }
      }
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: employee, error: null }) }) }) }
      }
      if (table === 'contracts') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: contract, error: null }) }) }) }
      }
      if (table === 'documents') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'doc-1', storage_kind: 'internal' }, error: null }) }) }),
        }
      }
      if (table === 'audit_log') {
        return { insert: jest.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })
    mockSupabase.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null, data: { path: 'x' } }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null }),
    })
  }

  it('manager gera o PDF do relatório e retorna o documentId', async () => {
    const app = await buildDocumentsApp()
    mockJobAndReportChain()

    const res = await app.inject({
      method: 'POST', url: `/documents/generate-report/${jobId}`, headers: { 'x-test-user': mgr },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().documentId).toBe('doc-1')
  })

  it('404 quando o job não existe', async () => {
    const app = await buildDocumentsApp()
    mockJobAndReportChain({ job: null })

    const res = await app.inject({
      method: 'POST', url: `/documents/generate-report/${jobId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 quando o relatório da OS ainda não foi enviado', async () => {
    const app = await buildDocumentsApp()
    mockJobAndReportChain({ report: null })

    const res = await app.inject({
      method: 'POST', url: `/documents/generate-report/${jobId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(404)
  })

  it('employee recebe 403', async () => {
    const app = await buildDocumentsApp()
    const res = await app.inject({
      method: 'POST', url: `/documents/generate-report/${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /documents/:id/url', () => {
  it('retorna signed URL para documento internal', async () => {
    const app = await buildDocumentsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'doc-1', entity_type: 'job', entity_id: jobId, storage_kind: 'internal', bucket: 'documents', path: 'job/x/y.pdf' },
            error: null,
          }),
        }),
      }),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    })
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null }),
    })

    const res = await app.inject({ method: 'GET', url: `/documents/${jobId}/url`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://signed/x')
  })

  it('404 quando o documento não existe', async () => {
    const app = await buildDocumentsApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: `/documents/${jobId}/url`, headers: { 'x-test-user': mgr } })
    expect(res.statusCode).toBe(404)
  })
})
