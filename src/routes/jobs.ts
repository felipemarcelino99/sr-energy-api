import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { insertNotification } from '@/services/notification.service'

const jobBody = z.object({
  employee_id: z.string().min(1),
  machine_id: z.string().min(1),
  job_type: z.enum(['maintenance', 'implementation']),
  description: z.string().min(1),
  scheduled_date: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  accommodation: z.boolean(),
  car: z.boolean(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  notes: z.string().optional(),
})

const jobs: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    let query = db.from('jobs')
      .select(`*, employees(name), machines(name)`)
    if (req.user.role === 'employee') {
      // Busca employee_id pelo user_id do JWT
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return []
      query = (query as any).eq('employee_id', emp.id)
    }
    const { data, error } = await (query as any).order('scheduled_date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return (data ?? []).map((j: any) => ({
      ...j,
      employee_name: j.employees?.name,
      machine_name: j.machines?.name,
      employees: undefined,
      machines: undefined,
    }))
  })

  // GET /jobs/:id
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('jobs')
      .select(`*, employees(name), machines(name, manual_url)`)
      .eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return { ...data, employee_name: data.employees?.name, machine: data.machines }
  })

  // POST /jobs
  fastify.post('/', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = jobBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('jobs').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    // Notificar funcionário
    const { data: emp } = await db.from('employees').select('user_id').eq('id', parsed.data.employee_id).single()
    if (emp?.user_id) {
      await insertNotification(db, emp.user_id,
        'Novo trabalho agendado',
        `Você tem um trabalho agendado para ${parsed.data.scheduled_date} em ${parsed.data.city}/${parsed.data.state}.`)
    }
    return reply.status(201).send(data)
  })

  // PUT /jobs/:id
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = jobBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('jobs').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // PATCH /jobs/:id/cancel
  fastify.patch<{ Params: { id: string } }>('/:id/cancel', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })
}

export default jobs
