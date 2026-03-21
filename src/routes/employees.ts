import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const employeeBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(8),
  role: z.enum(['employee', 'manager']),
  cnpj: z.string().optional(),
  salary: z.coerce.number().positive(),
  hired_at: z.string().min(1),
})

const salaryAdjBody = z.object({
  new_salary: z.coerce.number().positive(),
  reason: z.string().min(5),
})

const employees: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /employees
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('employees').select('*').order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /employees/:id
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('employees').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // POST /employees
  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    if (!['manager', 'admin'].includes((req as any).user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = employeeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('employees').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // PUT /employees/:id
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = employeeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('employees').update({
      ...parsed.data, updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // DELETE /employees/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('employees').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // GET /employees/:id/salary-adjustments
  fastify.get<{ Params: { id: string } }>('/:id/salary-adjustments', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('salary_adjustments')
      .select('*').eq('employee_id', req.params.id).order('adjusted_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // POST /employees/:id/salary-adjustments
  fastify.post<{ Params: { id: string } }>('/:id/salary-adjustments', { onRequest: [guard] }, async (req, reply) => {
    const parsed = salaryAdjBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    // busca salário atual
    const { data: emp } = await db.from('employees').select('salary').eq('id', req.params.id).single()
    if (!emp) return reply.status(404).send({ error: 'Employee not found' })
    const adj = { employee_id: req.params.id, previous_salary: emp.salary, new_salary: parsed.data.new_salary, reason: parsed.data.reason }
    const [{ data }, _] = await Promise.all([
      db.from('salary_adjustments').insert(adj).select().single(),
      db.from('employees').update({ salary: parsed.data.new_salary, updated_at: new Date().toISOString() }).eq('id', req.params.id),
    ])
    return reply.status(201).send(data)
  })
}

export default employees
