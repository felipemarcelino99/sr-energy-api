import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { detectMimeFromBuffer } from '@/utils/file-signature'
import { isJobMember } from '@/routes/jobs'

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
// usuário é admin/manager) antes de deixar criar/editar/ler relatório daquele job.
// Retorna o job (id + status) em caso de sucesso — status é usado por quem
// precisa validar transição (ex.: POST só aceita job em in_progress), null em
// caso de acesso negado (a resposta HTTP já foi enviada nesse caso).
//
// Sub-plano 02 (épico ajustes-cliente-2026-09), item 5: antes só olhava
// `jobs.employee_id`, ignorando `job_employees` (colaborador adicional via
// múltiplos colaboradores, sub-plano 04) — um colaborador vinculado só por
// `job_employees` recebia 404 indevido. Corrigido via `isJobMember`
// (src/routes/jobs.ts), mesma checagem de dupla fonte usada no resto do app.
async function assertJobOwnership(db: any, req: any, reply: any): Promise<{ id: string; status: string } | null> {
  if (req.user.role === 'admin' || req.user.role === 'manager') {
    const { data: job, error } = await db.from('jobs').select('id, status').eq('id', req.params.id).single()
    if (error || !job) {
      reply.status(404).send({ error: 'Not found' })
      return null
    }
    return job
  }

  const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
  if (!emp) {
    reply.status(403).send({ error: 'Employee not found' })
    return null
  }
  const { data: job, error } = await db.from('jobs').select('id, status').eq('id', req.params.id).single()
  if (error || !job) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  const member = await isJobMember(db, job.id, emp.id)
  if (!member) {
    reply.status(404).send({ error: 'Not found' })
    return null
  }
  return job
}

const reports: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /jobs/:id/report — sub-plano 02, item 5: passa a verificar o dono
  // (antes qualquer usuário autenticado lia o relatório de qualquer OS,
  // bastando saber o id do job).
  fastify.get<{ Params: { id: string } }>('/jobs/:id/report', { onRequest: [guard] }, async (req: any, reply) => {
    if (!(await assertJobOwnership(db, req, reply))) return
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
    const ownedJob = await assertJobOwnership(db, req, reply)
    if (!ownedJob) return
    // Sub-plano 02, item 5: só aceita relatório com a OS em andamento — reforça
    // o fluxo start -> report (PATCH /jobs/:id/start leva a in_progress).
    if (ownedJob.status !== 'in_progress') {
      return reply.status(409).send({ error: `OS precisa estar em andamento para registrar relatório (status atual: ${ownedJob.status})` })
    }
    const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
    // admin/manager podem não ter registro de employee — job_reports.employee_id é NOT NULL,
    // então cai pro employee dono do job (o relatório é sobre o job, não sobre quem preencheu).
    let employeeId = emp?.id ?? null
    if (!employeeId) {
      const { data: job } = await db.from('jobs').select('employee_id').eq('id', req.params.id).single()
      employeeId = job?.employee_id ?? null
      // Bug A4: jobs.employee_id (legado) pode estar nulo mesmo com colaborador(es)
      // vinculado(s) via job_employees (many-to-many, ver supabase/migrations/
      // 017_jobs_pc_os_extension.sql). Antes de dar 422, cai pro mais antigo
      // (created_at asc) vinculado ao job — ordem determinística.
      if (!employeeId) {
        const { data: jobEmployees } = await db.from('job_employees')
          .select('employee_id')
          .eq('job_id', req.params.id)
          .order('created_at', { ascending: true })
          .limit(1)
        employeeId = jobEmployees?.[0]?.employee_id ?? null
      }
    }
    if (!employeeId) return reply.status(422).send({ error: 'Job sem funcionário responsável atribuído' })
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
