import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { indexMachineManual } from '@/services/rag.service'
import { uploadFile } from '@/services/storage.service'

const machineBody = z.object({
  name: z.string().min(2),
  brand: z.string().min(1),
  model: z.string().min(1),
  serial_number: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1),
  manual_url: z.string().optional(),
})

const machines: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('machines').select('*').order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('machines').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = machineBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('machines').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = machineBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('machines').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('machines').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // GET /machines/:id/jobs
  fastify.get<{ Params: { id: string } }>('/:id/jobs', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db
      .from('jobs')
      .select(`id, scheduled_date, city, state, job_type, status, employees(name)`)
      .eq('machine_id', req.params.id)
      .order('scheduled_date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return (data ?? []).map((j: any) => {
      const { employees, ...rest } = j
      return { ...rest, employee_name: employees?.name ?? rest.employee_name }
    })
  })

  // GET /machines/:id/tools
  fastify.get<{ Params: { id: string } }>('/:id/tools', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db
      .from('machine_tools')
      .select('*, tools(*)')
      .eq('machine_id', req.params.id)
      .order('created_at' as any)
    if (error) return reply.status(500).send({ error: error.message })
    return data ?? []
  })

  // POST /machines/:id/tools
  fastify.post<{ Params: { id: string } }>('/:id/tools', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = z.object({
      tool_id: z.string().uuid(),
      quantity_required: z.coerce.number().int().min(1).default(1),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db
      .from('machine_tools')
      .insert({ machine_id: req.params.id, ...parsed.data })
      .select('*, tools(*)')
      .single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // DELETE /machines/:id/tools/:toolId
  fastify.delete<{ Params: { id: string; toolId: string } }>('/:id/tools/:toolId', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const { error } = await db
      .from('machine_tools')
      .delete()
      .eq('machine_id', req.params.id)
      .eq('tool_id', req.params.toolId)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // POST /machines/:id/manual
  fastify.post<{ Params: { id: string } }>('/:id/manual', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const buffer = await file.toBuffer()
    const url = await uploadFile(fastify.supabase, 'machine-manuals', `${req.params.id}.pdf`, buffer, 'application/pdf')
    await db.from('machines').update({ manual_url: url, updated_at: new Date().toISOString() }).eq('id', req.params.id)
    // Indexa async (não bloqueia a resposta)
    indexMachineManual(fastify.supabase, req.params.id, buffer).catch(console.error)
    return { url }
  })
}

export default machines
