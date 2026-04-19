import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'

const reportBody = z.object({
  content: z.string().min(1, 'Relatório não pode estar vazio'),
})

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'audio/mpeg']
function mimeToType(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  return 'audio'
}

const reports: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs/:id/report
  fastify.get<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('job_reports')
      .select(`*, evidences(*)`)
      .eq('job_id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Report not found' })
    return data
  })

  // POST /jobs/:id/report
  fastify.post<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = reportBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })
    const { data, error } = await db.from('job_reports')
      .insert({ job_id: req.params.id, content: parsed.data.content, employee_id: emp.id })
      .select().single()
    if (error) return reply.status(500).send({ error: error.message })
    // Atualiza job: status=completed, report_id
    await db.from('jobs').update({ status: 'completed', report_id: data.id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
    return reply.status(201).send(data)
  })

  // PUT /jobs/:id/report
  fastify.put<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = reportBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('job_reports')
      .update({ content: parsed.data.content, updated_at: new Date().toISOString() })
      .eq('job_id', req.params.id)
      .select('*, evidences(*)')
      .single()
    if (error || !data) return reply.status(404).send({ error: 'Report not found' })
    return data
  })

  // POST /reports/:id/evidences
  fastify.post<{ Params: { id: string } }>('/reports/:id/evidences', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    if (!ALLOWED_MIME.includes(file.mimetype))
      return reply.status(400).send({ error: `Tipo ${file.mimetype} não permitido` })
    const buffer = await file.toBuffer()
    const key = `${req.params.id}/${Date.now()}-${file.filename}`
    const url = await uploadFile(fastify.supabase, 'evidences', key, buffer, file.mimetype)
    const { data, error } = await db.from('evidences').insert({
      report_id: req.params.id, url, mime_type: file.mimetype,
      file_name: file.filename, type: mimeToType(file.mimetype),
    }).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })
}

export default reports
