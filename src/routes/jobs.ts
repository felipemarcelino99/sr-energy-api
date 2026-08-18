import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { insertNotification } from '@/services/notification.service'
import { requireRoles } from '@/plugins/authorize'

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

// CRITICAL-01: employee não pode alterar campos administrativos (quem faz o job,
// em qual máquina, quando está agendado) — só admin/manager, via jobBody completo.
const employeeJobBody = jobBody.omit({ employee_id: true, machine_id: true, scheduled_date: true })

// CRITICAL-01/07 (IDOR): busca o employee.id do usuário logado e confere se o job
// pertence a ele. admin/manager sempre passam. Retorna null se acesso deve ser negado
// (já responde 404 nesse caso — não vazamos 403 para não confirmar a existência do job
// de outro colaborador).
async function loadOwnedJob(db: any, req: any, reply: any): Promise<{ id: string; employee_id: string } | null> {
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', req.params.id).single()
    if (error || !job) {
      reply.status(404).send({ error: 'Not found' })
      return null
    }
    return job
  }

  const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
  if (!emp) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', req.params.id).single()
  if (error || !job || job.employee_id !== emp.id) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  return job
}

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

  // GET /jobs/:id — CRITICAL-07 (IDOR): employee só vê job próprio; 404 (não 403) para não
  // confirmar a existência do job de outro colaborador.
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    const { data, error } = await db.from('jobs')
      .select(`*, employees(name), machines(name, manual_url)`)
      .eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    if (req.user.role === 'employee') {
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp || data.employee_id !== emp.id) return reply.status(404).send({ error: 'Not found' })
    }
    return { ...data, employee_name: data.employees?.name, machine: data.machines }
  })

  // POST /jobs
  // CRITICAL-02: insert do job, ajuste de estoque das ferramentas da máquina e
  // criação do checklist pre_work rodam dentro da RPC `create_job_with_provisioning`
  // (transação Postgres única). Se qualquer etapa falhar (ex.: checklist com FK
  // inválida), o Postgres desfaz tudo — nunca fica job sem checklist, ou estoque
  // debitado sem job. Ver supabase/migrations/015_atomic_operations.sql.
  fastify.post('/', { onRequest: [guard, requireRoles('manager', 'admin')] }, async (req, reply) => {
    const parsed = jobBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { data: result, error } = await db.rpc('create_job_with_provisioning', { p_job: parsed.data })
    if (error) return reply.status(500).send({ error: error.message })

    const job = (result as any).job
    const insufficientTools: string[] = (result as any).insufficient_tools ?? []

    // Notificar funcionário — best-effort, não deve derrubar a resposta 201 nem
    // desfazer a criação do job caso a notificação falhe (já é logado dentro de
    // insertNotification).
    const { data: emp } = await db.from('employees').select('user_id').eq('id', parsed.data.employee_id).single()
    if (emp?.user_id) {
      await insertNotification(db, emp.user_id,
        'Novo trabalho agendado',
        `Você tem um trabalho agendado para ${parsed.data.scheduled_date} em ${parsed.data.city}/${parsed.data.state}.`)
    }

    return reply.status(201).send({ ...job, insufficient_tools: insufficientTools })
  })

  // PUT /jobs/:id — CRITICAL-01 (IDOR): employee só edita job próprio, e só campos não
  // administrativos (employee_id, machine_id, scheduled_date ficam restritos a admin/manager).
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    const isAdminOrManager = ['admin', 'manager'].includes(req.user.role)
    const schema = isAdminOrManager ? jobBody : employeeJobBody
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const owned = await loadOwnedJob(db, req, reply)
    if (!owned) return

    const { data, error } = await db.from('jobs').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // PATCH /jobs/:id/cancel — CRITICAL-01 (IDOR): employee só cancela job próprio.
  fastify.patch<{ Params: { id: string } }>('/:id/cancel', { onRequest: [guard] }, async (req: any, reply) => {
    const owned = await loadOwnedJob(db, req, reply)
    if (!owned) return

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

// CRITICAL-01/9: ajuste atômico de estoque via RPC `adjust_tool_stock` — um único
// UPDATE (row-level lock do Postgres) em vez de ler quantity, calcular em memória e
// escrever de volta. Elimina a corrupção de estoque sob concorrência (duas criações/
// cancelamentos de job para a mesma ferramenta ao mesmo tempo). Usado tanto para
// consumir estoque (delta negativo) quanto para restaurar (delta positivo).
async function adjustToolStock(db: any, toolId: string, delta: number): Promise<void> {
  const { error } = await db.rpc('adjust_tool_stock', { p_tool_id: toolId, p_delta: delta })
  if (error) throw new Error(`Falha ao ajustar estoque da ferramenta ${toolId}: ${error.message}`)
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
    .select('tool_id, quantity_required, tools(id)')
    .eq('machine_id', machineId)

  if (!machineTools) return

  for (const mt of machineTools) {
    const tool = (mt as any).tools
    if (tool) {
      await adjustToolStock(db, tool.id, mt.quantity_required)
    }
  }
}

export default jobs
