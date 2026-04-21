import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireRoles } from '@/plugins/authorize'

// HIGH-06: whitelist explícita de campos — exclui campos internos (user_id, google_refresh_token)
const employeeBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(8).max(20),
  role: z.enum(['employee', 'manager']),
  cnpj: z.string().optional(),
  salary: z.coerce.number().positive(),
  hired_at: z.string().min(1),
})

const salaryAdjBody = z.object({
  new_salary: z.coerce.number().positive(),
  reason: z.string().min(5).max(500),
})

// HIGH-05: schema de validação UUID para path params
const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

// MED-04: colunas seguras — exclui google_refresh_token
const SAFE_COLUMNS = 'id, name, email, phone, role, cnpj, salary, hired_at, created_at, updated_at, user_id'

const employees: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /employees
  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    // MED-04: select explícito, sem google_refresh_token
    const { data, error } = await db.from('employees').select(SAFE_COLUMNS).order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /employees/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('employees').select(SAFE_COLUMNS).eq('id', req.params.id).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // POST /employees — HIGH-01: apenas admin ou manager
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = employeeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { data, error } = await db.from('employees').insert(parsed.data).select(SAFE_COLUMNS).single()
    if (error) return reply.status(500).send({ error: error.message })

    // Cria usuário no Supabase Auth com senha padrão
    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email: parsed.data.email,
      password: 'srenergy@123',
      email_confirm: true,
      user_metadata: { role: parsed.data.role, name: parsed.data.name },
    })

    if (!authError && authData?.user) {
      const userId = authData.user.id
      await Promise.all([
        db.from('user_roles').insert({ user_id: userId, role: parsed.data.role }),
        db.from('employees').update({ user_id: userId }).eq('id', data.id),
      ])
      return reply.status(201).send({ ...data, user_id: userId })
    }

    return reply.status(201).send(data)
  })

  // PUT /employees/:id — HIGH-01: apenas admin ou manager
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = employeeBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('employees').update({
        ...parsed.data, updated_at: new Date().toISOString(),
      }).eq('id', req.params.id).select(SAFE_COLUMNS).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // DELETE /employees/:id — HIGH-01: apenas admin
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, requireRoles('admin')], schema: { params: uuidParams } },
    async (req, reply) => {
      const { error } = await db.from('employees').delete().eq('id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      return reply.status(204).send()
    },
  )

  // GET /employees/:id/salary-adjustments — HIGH-01: admin ou manager
  fastify.get<{ Params: { id: string } }>(
    '/:id/salary-adjustments',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('salary_adjustments')
        .select('id, employee_id, previous_salary, new_salary, reason, adjusted_at')
        .eq('employee_id', req.params.id)
        .order('adjusted_at', { ascending: false })
      if (error) return reply.status(500).send({ error: error.message })
      return data
    },
  )

  // POST /employees/:id/salary-adjustments — HIGH-01: admin ou manager
  fastify.post<{ Params: { id: string } }>(
    '/:id/salary-adjustments',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = salaryAdjBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data: emp } = await db.from('employees').select('salary').eq('id', req.params.id).single()
      if (!emp) return reply.status(404).send({ error: 'Employee not found' })
      const adj = {
        employee_id: req.params.id,
        previous_salary: emp.salary,
        new_salary: parsed.data.new_salary,
        reason: parsed.data.reason,
      }
      const [{ data }] = await Promise.all([
        db.from('salary_adjustments').insert(adj).select().single(),
        db.from('employees').update({ salary: parsed.data.new_salary, updated_at: new Date().toISOString() }).eq('id', req.params.id),
      ])
      return reply.status(201).send(data)
    },
  )
}

export default employees
