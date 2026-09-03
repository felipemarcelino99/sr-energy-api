import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireRoles } from '@/plugins/authorize'
import { record as recordAuditEvent } from '@/services/audit-log.service'

// Sub-plano 04 (fluxo PC-OS), revisão: Proposta Comercial (PC) vive em `proposals`
// (ver supabase/migrations/021_proposals_split.sql). `number`/`status` nunca vêm
// do body — `number` é gerado pelo banco (DEFAULT next_document_number()) e
// `status` sempre nasce `pending`.
const proposalBody = z.object({
  client_id: z.string().uuid('Cliente é obrigatório'),
  description: z.string().min(1).max(2000),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  contract_type: z.enum(['service', 'rental']).optional(),
  contract_value: z.number().min(0).optional(),
  recurring: z.boolean().optional(),
  file_url: z.string().optional(),
}).refine(d => new Date(d.end_date) >= new Date(d.start_date), {
  message: 'end_date must be after start_date', path: ['end_date'],
})

// HIGH-05: schema de validação UUID para path params
const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const SELECT_PROPOSAL = 'id, number, client_id, description, contract_type, contract_value, recurring, start_date, end_date, file_url, status, contract_id, job_id, created_at, updated_at, clients(id, razao_social, cnpj)'

// Sub-plano 04, item 5: transição de status de proposta grava no audit-log
// (append-only, ver supabase/migrations/019_audit_log.sql). Best-effort — nunca
// derruba a resposta HTTP da transição por falha de log (ver audit-log.service).
async function recordProposalAuditEvent(
  db: Parameters<typeof recordAuditEvent>[0],
  event: { action: 'proposal.accepted' | 'proposal.rejected'; proposalId: string; actorId: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await recordAuditEvent(db, {
    entityType: 'proposal',
    entityId: event.proposalId,
    actorId: event.actorId,
    action: event.action,
    metadata: event.metadata,
  })
}

const proposals: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /proposals — suporta ?clientId= (query param não é convertido pelo axios)
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { clientId } = req.query as { clientId?: string }
    let query = db.from('proposals').select(SELECT_PROPOSAL).order('created_at', { ascending: false })
    if (clientId) {
      query = query.eq('client_id', clientId)
    }
    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('proposals')
        .select(SELECT_PROPOSAL)
        .eq('id', req.params.id).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // HIGH-01: apenas admin ou manager podem criar/editar propostas
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = proposalBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('proposals').insert(parsed.data).select(SELECT_PROPOSAL).single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = proposalBody.partial().safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('proposals')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select(SELECT_PROPOSAL).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // PATCH /proposals/:id/accept — cria Contrato novo + OS nova via RPC
  // transacional `accept_proposal` (ver supabase/migrations/021_proposals_split.sql).
  // A PC em si nunca muda de tabela, só de `status` + vínculos.
  fastify.patch<{ Params: { id: string } }>(
    '/:id/accept',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.rpc('accept_proposal', { p_proposal_id: req.params.id })
      if (error) {
        if (error.message?.includes('not found')) return reply.status(404).send({ error: 'Not found' })
        if (error.message?.includes('is not pending')) return reply.status(409).send({ error: 'Proposta não está pendente' })
        return reply.status(500).send({ error: error.message })
      }
      const result = data as { proposal: Record<string, unknown>; contract: Record<string, unknown>; job: Record<string, unknown> }
      await recordProposalAuditEvent(db, {
        action: 'proposal.accepted',
        proposalId: req.params.id,
        actorId: (req as any).user.id,
        metadata: { contractId: result.contract?.id, jobId: result.job?.id, number: result.proposal?.number },
      })
      return reply.status(200).send(result)
    },
  )

  // PATCH /proposals/:id/reject — transição pending -> rejected (mantém histórico
  // completo de PCs recusadas, sem gerar Contrato/OS).
  fastify.patch<{ Params: { id: string } }>(
    '/:id/reject',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.rpc('reject_proposal', { p_proposal_id: req.params.id })
      if (error) {
        if (error.message?.includes('not found')) return reply.status(404).send({ error: 'Not found' })
        if (error.message?.includes('is not pending')) return reply.status(409).send({ error: 'Proposta não está pendente' })
        return reply.status(500).send({ error: error.message })
      }
      await recordProposalAuditEvent(db, {
        action: 'proposal.rejected',
        proposalId: req.params.id,
        actorId: (req as any).user.id,
      })
      return reply.status(200).send(data)
    },
  )
}

export default proposals
