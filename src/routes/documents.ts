import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { detectMimeFromBuffer } from '@/utils/file-signature'
import { requireRoles } from '@/plugins/authorize'
import { attachDocument, linkLegacyDocument, listDocuments, getDocumentById, resolveDocumentUrl, type DocumentEntityType } from '@/services/documents.service'
import { generateReportPdf } from '@/services/document-generation.service'
import { isJobAssignedToEmployee } from '@/routes/jobs'

const entityType = z.enum(['contract', 'job'])

const listQuery = z.object({
  entityType,
  entityId: z.string().uuid(),
})

const attachFields = z.object({
  entityType,
  entityId: z.string().uuid(),
  label: z.string().max(200).optional(),
})

const linkLegacyBody = z.object({
  entityType,
  entityId: z.string().uuid(),
  driveUrl: z.string().url('URL do Drive inválida'),
  note: z.string().min(1, 'Motivo/contexto do vínculo é obrigatório'),
  label: z.string().max(200).optional(),
})

// R-FUP.4: nome de arquivo do cliente nunca vira path direto (path traversal via
// `../`, `/`, caracteres de controle). Mantém só um sufixo seguro para leitura
// humana; quem garante unicidade é o prefixo `${Date.now()}-`.
function sanitizeFilenameSuffix(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'arquivo'
}

const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const documents: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // IDOR (mesmo achado do sub-plano 01 em jobs.ts): documento de OS não pode
  // ser lido por um employee que não está atribuído àquela OS — senão a
  // restrição de acesso a job feita em jobs.ts fica furada por aqui.
  // `contract` segue a mesma permissividade já existente em contracts.ts (GET
  // ali também não restringe por role, só por auth) — não é regressão nova.
  // Mismatch responde 404 (não 403) para não confirmar existência do recurso.
  async function assertEmployeeCanAccessEntity(
    req: any, reply: any, entityType: DocumentEntityType, entityId: string,
  ): Promise<boolean> {
    if (req.user.role !== 'employee' || entityType !== 'job') return true
    const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
    if (!emp) {
      reply.status(404).send({ error: 'Not found' })
      return false
    }
    const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', entityId).single()
    if (error || !job) {
      reply.status(404).send({ error: 'Not found' })
      return false
    }
    const owned = await isJobAssignedToEmployee(db, job.id, emp.id, job.employee_id)
    if (!owned) {
      reply.status(404).send({ error: 'Not found' })
      return false
    }
    return true
  }

  // GET /documents?entityType=&entityId= — lista documentos (internos + Drive
  // vinculado) de um contrato/OS, mais recentes primeiro.
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    if (!(await assertEmployeeCanAccessEntity(req, reply, parsed.data.entityType, parsed.data.entityId))) return
    const data = await listDocuments(db, parsed.data.entityType, parsed.data.entityId)
    return data
  })

  // POST /documents — anexa arquivo nativo do portal (item 6). Item 9
  // (document-generation) usa o service diretamente, sem passar por multipart.
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req: any, reply) => {
    const parts = req.parts()
    let fileBuffer: Buffer | null = null
    let filename = ''
    const rawFields: Record<string, string> = {}

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer()
        filename = part.filename
      } else {
        rawFields[part.fieldname] = (part as any).value as string
      }
    }

    if (!fileBuffer) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const parsedFields = attachFields.safeParse(rawFields)
    if (!parsedFields.success) return reply.status(400).send({ error: parsedFields.error.flatten() })

    const detectedMime = detectMimeFromBuffer(fileBuffer)
    if (!detectedMime) {
      return reply.status(400).send({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG ou PNG.' })
    }

    const path = `${parsedFields.data.entityType}/${parsedFields.data.entityId}/${Date.now()}-${sanitizeFilenameSuffix(filename)}`
    await uploadFile(db, 'documents', path, fileBuffer, detectedMime)
    try {
      const doc = await attachDocument(db, {
        entityType: parsedFields.data.entityType,
        entityId: parsedFields.data.entityId,
        bucket: 'documents',
        path,
        label: parsedFields.data.label,
        actorId: req.user.id,
      })
      return reply.status(201).send(doc)
    } catch (err) {
      // O arquivo já subiu no storage antes do insert no banco (storage não
      // participa de transação Postgres) — se o insert falhar, remove o
      // arquivo órfão (mesmo padrão de compensação de bags.ts).
      try {
        await db.storage.from('documents').remove([path])
      } catch (cleanupErr) {
        fastify.log.error(cleanupErr, 'failed to remove orphaned document file after insert failure')
      }
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // POST /documents/link-legacy — vincula acervo legado do Drive (item 7).
  fastify.post('/link-legacy', { onRequest: [guard, adminOrManager] }, async (req: any, reply) => {
    const parsed = linkLegacyBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const doc = await linkLegacyDocument(db, { ...parsed.data, actorId: req.user.id })
    return reply.status(201).send(doc)
  })

  // POST /documents/generate-report/:id — gera o PDF do relatório técnico da
  // OS (item 9) a partir do que já foi enviado em POST /jobs/:id/report
  // (reports.ts) e grava como documento `internal` (item 6).
  fastify.post<{ Params: { id: string } }>(
    '/generate-report/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req: any, reply) => {
      const { data: job, error: jobError } = await db.from('jobs')
        .select('id, number, description, scheduled_date, city, state, employee_id, contract_id')
        .eq('id', req.params.id).single()
      if (jobError || !job) return reply.status(404).send({ error: 'Not found' })

      const { data: report, error: reportError } = await db.from('job_reports')
        .select('content, evidences(file_name, type)')
        .eq('job_id', req.params.id).single()
      if (reportError || !report) return reply.status(404).send({ error: 'Relatório da OS ainda não foi enviado' })

      const [{ data: employee }, { data: contract }] = await Promise.all([
        job.employee_id
          ? db.from('employees').select('name').eq('id', job.employee_id).single()
          : Promise.resolve({ data: null }),
        job.contract_id
          ? db.from('contracts').select('clients(razao_social)').eq('id', job.contract_id).single()
          : Promise.resolve({ data: null }),
      ])

      const documentId = await generateReportPdf(db, req.params.id, {
        jobNumber: job.number ?? req.params.id,
        clientName: (contract?.clients as any)?.razao_social ?? (contract?.clients as any)?.[0]?.razao_social ?? 'N/A',
        description: job.description ?? '',
        scheduledDate: job.scheduled_date ?? 'N/A',
        city: job.city ?? 'N/A',
        state: job.state ?? 'N/A',
        reportContent: report.content,
        employeeName: employee?.name ?? 'N/A',
        evidences: (report.evidences ?? []).map((e: any) => ({ fileName: e.file_name, type: e.type })),
      }, req.user.id)

      return reply.status(201).send({ documentId })
    },
  )

  // GET /documents/:id/url — signed URL sob demanda (internal) ou URL do Drive
  // (drive_link); toda chamada loga acesso no audit-log (ver documents.service).
  fastify.get<{ Params: { id: string } }>(
    '/:id/url',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req: any, reply) => {
      const doc = await getDocumentById(db, req.params.id)
      if (!doc) return reply.status(404).send({ error: 'Not found' })
      if (!(await assertEmployeeCanAccessEntity(req, reply, doc.entity_type, doc.entity_id))) return
      const url = await resolveDocumentUrl(db, doc, req.user.id)
      return { url }
    },
  )
}

export default documents
