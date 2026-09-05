import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'crypto'
import { indexMachineManual } from '@/services/rag.service'
import { uploadFile } from '@/services/storage.service'
import { getOrGenerateOverview } from '@/services/rag.overview.service'
import { requireRoles } from '@/plugins/authorize'

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
  const adminOrManager = requireRoles('admin', 'manager')

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
      .select(
        `id, scheduled_date, city, state, job_type, status, employees!jobs_employee_id_fkey(name)`,
      )
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
    if (error) return reply.status(500).send({ error: error.message })
    return data ?? []
  })

  // POST /machines/:id/tools
  fastify.post<{ Params: { id: string } }>('/:id/tools', { onRequest: [guard, adminOrManager] }, async (req: any, reply) => {
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
  fastify.delete<{ Params: { id: string; toolId: string } }>('/:id/tools/:toolId', { onRequest: [guard, adminOrManager] }, async (req: any, reply) => {
    const { error } = await db
      .from('machine_tools')
      .delete()
      .eq('machine_id', req.params.id)
      .eq('tool_id', req.params.toolId)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // GET /machines/:id/documents
  fastify.get<{ Params: { id: string } }>('/:id/documents', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('machine_documents')
      .select('id, filename, url, created_at')
      .eq('machine_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data ?? []
  })

  // POST /machines/:id/manual
  fastify.post<{ Params: { id: string } }>('/:id/manual', { onRequest: [guard, adminOrManager] }, async (req: any, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const buffer = await file.toBuffer()
    const filename = file.filename || 'manual.pdf'
    const pdfHash = createHash('sha256').update(buffer).digest('hex')

    // Bloqueia duplicatas
    const { data: dup } = await db.from('machine_documents')
      .select('id').eq('machine_id', req.params.id).eq('pdf_hash', pdfHash).single()
    if (dup) return reply.status(409).send({ error: 'Este arquivo já foi enviado anteriormente.' })

    // Cria registro do documento
    const { data: doc, error: docError } = await db.from('machine_documents')
      .insert({ machine_id: req.params.id, filename, pdf_hash: pdfHash, url: '' })
      .select('id').single()
    if (docError || !doc) return reply.status(500).send({ error: docError?.message })

    const storagePath = `${req.params.id}/${doc.id}.pdf`
    const url = await uploadFile(fastify.supabase, 'machine-manuals', storagePath, buffer, 'application/pdf')
    await db.from('machine_documents').update({ url }).eq('id', doc.id)

    indexMachineManual(fastify.supabase, req.params.id, doc.id, buffer).catch((err) =>
      fastify.log.error(err, 'machine manual indexing failed'),
    )
    return reply.status(201).send({ id: doc.id, filename, url })
  })

  // DELETE /machines/:id/documents/:docId
  fastify.delete<{ Params: { id: string; docId: string } }>(
    '/:id/documents/:docId',
    { onRequest: [guard, adminOrManager] },
    async (req: any, reply) => {
      const { data: doc } = await db.from('machine_documents')
        .select('id').eq('id', req.params.docId).eq('machine_id', req.params.id).single()
      if (!doc) return reply.status(404).send({ error: 'Documento não encontrado' })
      await fastify.supabase.storage.from('machine-manuals')
        .remove([`${req.params.id}/${req.params.docId}.pdf`])
      await db.from('machine_documents').delete().eq('id', req.params.docId)
      return reply.status(204).send()
    }
  )

  // GET /machines/:id/overview
  fastify.get<{ Params: { id: string } }>('/:id/overview', { onRequest: [guard] }, async (req, reply) => {
    try {
      const overview = await getOrGenerateOverview(fastify.supabase, req.params.id)
      return { overview }
    } catch (err: any) {
      if (err.message?.includes('não indexado')) return reply.status(404).send({ error: err.message })
      return reply.status(502).send({ error: 'Erro ao gerar overview. Tente novamente.' })
    }
  })
}

export default machines
