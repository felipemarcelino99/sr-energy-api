import { buildApp, mockSupabase } from '../helpers/build-app'
import auditLogRoute from '@/routes/audit-log'

const mgr = JSON.stringify({ id: 'mgr-1', role: 'manager', name: 'Mgr', email: 'm@sr.com' })
const emp = JSON.stringify({ id: 'emp-1', role: 'employee', name: 'João', email: 'j@sr.com' })
const jobId = 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd'
const contractId = 'a1a1a1a1-2669-4bf6-81d3-e4ae73fb11fd'

beforeEach(() => jest.clearAllMocks())
afterEach(() => mockSupabase.from.mockReturnThis())

async function buildAuditLogApp() {
  const app = buildApp()
  app.register(auditLogRoute, { prefix: '/audit-log' })
  await app.ready()
  return app
}

describe('GET /audit-log', () => {
  it('retorna o histórico ordenado por entityType/entityId', async () => {
    const app = await buildAuditLogApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [{ id: 'ev-1', action: 'contract.accepted', entity_type: 'contract', entity_id: contractId }],
          error: null,
        }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: `/audit-log?entityType=contract&entityId=${contractId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('400 quando entityType é inválido', async () => {
    const app = await buildAuditLogApp()
    const res = await app.inject({
      method: 'GET', url: `/audit-log?entityType=invalid&entityId=${jobId}`, headers: { 'x-test-user': mgr },
    })
    expect(res.statusCode).toBe(400)
  })

})

describe('GET /audit-log — IDOR (employee só vê histórico de OS própria)', () => {
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
      if (table === 'audit_log') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'ev-1' }], error: null }) }) }) }) }
      }
      return {}
    })
  }

  it('404 quando o employee não está atribuído ao job (nem legado, nem job_employees)', async () => {
    const app = await buildAuditLogApp()
    mockEmployeeJobChain({ employeeId: 'emp-1', jobEmployeeId: 'other-emp', linked: false })
    const res = await app.inject({
      method: 'GET', url: `/audit-log?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(404)
  })

  it('200 quando o employee está atribuído ao job via job_employees', async () => {
    const app = await buildAuditLogApp()
    mockEmployeeJobChain({ employeeId: 'emp-1', jobEmployeeId: null, linked: true })
    const res = await app.inject({
      method: 'GET', url: `/audit-log?entityType=job&entityId=${jobId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
  })

  it('employee acessa histórico de contrato sem checagem extra de ownership de job', async () => {
    const app = await buildAuditLogApp()
    mockSupabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [{ id: 'ev-1' }], error: null }),
      }),
    })
    const res = await app.inject({
      method: 'GET', url: `/audit-log?entityType=contract&entityId=${contractId}`, headers: { 'x-test-user': emp },
    })
    expect(res.statusCode).toBe(200)
  })
})
