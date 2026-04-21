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
  address: z.string().optional(),
  car_pickup_time: z.string().optional(),
  car_return_time: z.string().optional(),
  car_pickup_address: z.string().optional(),
  os_code: z.string().optional(),
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

    const { data: job, error } = await db.from('jobs').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })

    // Gerar checklist e controlar estoque
    const { data: machineTools } = await db
      .from('machine_tools')
      .select('*, tools(*)')
      .eq('machine_id', parsed.data.machine_id)

    const insufficientTools: string[] = []

    if (machineTools && machineTools.length > 0) {
      for (const mt of machineTools) {
        const tool = (mt as any).tools
        if (tool && tool.quantity < mt.quantity_required) {
          insufficientTools.push(tool.name)
        }
        // Reduz estoque (mínimo 0)
        if (tool) {
          const newQty = Math.max(0, tool.quantity - mt.quantity_required)
          await db.from('tools').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', tool.id)
        }
      }

      // Cria itens de checklist (pre_work)
      const checklistItems = machineTools.map((mt: any) => ({
        job_id: job.id,
        employee_id: parsed.data.employee_id,
        tool_id: mt.tool_id,
        phase: 'pre_work',
      }))
      await db.from('job_checklists').insert(checklistItems)
    }

    // Notificar funcionário
    const { data: emp } = await db.from('employees').select('user_id').eq('id', parsed.data.employee_id).single()
    if (emp?.user_id) {
      await insertNotification(db, emp.user_id,
        'Novo trabalho agendado',
        `Você tem um trabalho agendado para ${parsed.data.scheduled_date} em ${parsed.data.city}/${parsed.data.state}.`)
    }

    return reply.status(201).send({ ...job, insufficient_tools: insufficientTools })
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
    await restoreToolStock(db, req.params.id)
    return data
  })

  // GET /jobs/:id/checklist
  fastify.get<{ Params: { id: string }; Querystring: { phase?: string } }>('/:id/checklist', { onRequest: [guard] }, async (req, reply) => {
    let query = db
      .from('job_checklists')
      .select('*, tools(id, name, description)')
      .eq('job_id', req.params.id)
    if (req.query.phase) query = (query as any).eq('phase', req.query.phase)
    const { data, error } = await (query as any).order('created_at')
    if (error) return reply.status(500).send({ error: error.message })
    return data ?? []
  })

  // PATCH /jobs/:id/checklist/:itemId
  fastify.patch<{ Params: { id: string; itemId: string } }>('/:id/checklist/:itemId', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = z.object({ checked: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const update: any = {
      checked: parsed.data.checked,
      checked_at: parsed.data.checked ? new Date().toISOString() : null,
    }
    const { data, error } = await db
      .from('job_checklists')
      .update(update)
      .eq('id', req.params.itemId)
      .eq('job_id', req.params.id)
      .select()
      .single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // POST /jobs/:id/checklist/duplicate — duplica pre_work para pre_report
  fastify.post<{ Params: { id: string } }>('/:id/checklist/duplicate', { onRequest: [guard] }, async (req: any, reply) => {
    // Verifica se já existe pre_report
    const { data: existing } = await db
      .from('job_checklists')
      .select('id')
      .eq('job_id', req.params.id)
      .eq('phase', 'pre_report')
      .limit(1)
    if (existing && existing.length > 0) {
      const { data } = await db
        .from('job_checklists')
        .select('*, tools(id, name, description)')
        .eq('job_id', req.params.id)
        .eq('phase', 'pre_report')
        .order('created_at' as any)
      return data ?? []
    }

    const { data: preWork } = await db
      .from('job_checklists')
      .select('*')
      .eq('job_id', req.params.id)
      .eq('phase', 'pre_work')

    if (!preWork || preWork.length === 0)
      return reply.status(404).send({ error: 'No pre_work checklist found' })

    const newItems = preWork.map((item: any) => ({
      job_id: item.job_id,
      employee_id: item.employee_id,
      tool_id: item.tool_id,
      phase: 'pre_report',
      checked: false,
    }))

    const { data, error } = await db
      .from('job_checklists')
      .insert(newItems)
      .select('*, tools(id, name, description)')
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })
}

async function restoreToolStock(db: any, jobId: string) {
  const { data: items } = await db
    .from('job_checklists')
    .select('tool_id, jobs!inner(machine_id)')
    .eq('job_id', jobId)
    .eq('phase', 'pre_work')

  if (!items || items.length === 0) return

  const machineId = (items[0] as any).jobs?.machine_id
  if (!machineId) return

  const { data: machineTools } = await db
    .from('machine_tools')
    .select('tool_id, quantity_required, tools(id, quantity)')
    .eq('machine_id', machineId)

  if (!machineTools) return

  for (const mt of machineTools) {
    const tool = (mt as any).tools
    if (tool) {
      await db.from('tools')
        .update({ quantity: tool.quantity + mt.quantity_required, updated_at: new Date().toISOString() })
        .eq('id', tool.id)
    }
  }
}

export default jobs
