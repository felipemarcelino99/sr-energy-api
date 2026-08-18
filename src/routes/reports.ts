import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { detectMimeFromBuffer } from '@/utils/file-signature'

const reportBody = z.object({
  content: z.string().min(1, 'Relatório não pode estar vazio'),
})

// CRITICAL-05: além do mime declarado pelo cliente (fácil de forjar), exigimos que
// os magic bytes do arquivo batam com um formato conhecido (pdf/jpeg/png). vídeo/áudio
// não têm assinatura curta confiável aqui, então continuam validados só pelo Content-Type
// — mantendo o mesmo nível de proteção que existia antes para esses tipos.
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'audio/mpeg']
const SIGNATURE_CHECKED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf'])

function mimeToType(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  return 'audio'
}

// CRITICAL-02 (IDOR): confirma que o job pertence ao employee autenticado (ou que o
// usuário é admin/manager) antes de deixar criar/editar relatório daquele job.
async function assertJobOwnership(db: any, req: any, reply: any): Promise<boolean> {
  if (req.user.role === 'admin' || req.user.role === 'manager') return true

  const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
  if (!emp) {
    reply.status(403).send({ error: 'Employee not found' })
    return false
  }
  const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', req.params.id).single()
  if (error || !job) {
    reply.status(404).send({ error: 'Not found' })
    return false
  }
  if (job.employee_id !== emp.id) {
    reply.status(404).send({ error: 'Not found' })
    return false
  }
  return true
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
    if (!(await assertJobOwnership(db, req, reply))) return
    const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
    // admin/manager podem não ter registro de employee — nesse caso não amarramos employee_id
    const employeeId = emp?.id ?? null
    const { data, error } = await db.from('job_reports')
      .insert({ job_id: req.params.id, content: parsed.data.content, employee_id: employeeId })
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
    if (!(await assertJobOwnership(db, req, reply))) return
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

    // CRITICAL-05: valida magic bytes para os tipos com assinatura curta conhecida.
    if (SIGNATURE_CHECKED_MIME.has(file.mimetype)) {
      const detectedMime = detectMimeFromBuffer(buffer)
      if (detectedMime !== file.mimetype) {
        return reply.status(400).send({ error: 'Conteúdo do arquivo não corresponde ao tipo declarado' })
      }
    }

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
