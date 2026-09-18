import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireRoles } from '@/plugins/authorize'
import { record as recordAuditEvent } from '@/services/audit-log.service'

// Sub-plano 04 (fluxo PC-OS), revisão: Proposta Comercial (PC) vive em `proposals`
// (ver supabase/migrations/021_proposals_split.sql). `number`/`status` nunca vêm
// do body — `number` é gerado pelo banco (DEFAULT next_document_number()) e
// `status` sempre nasce `pending`.
//
// Sub-plano 01 (épico ajustes-cliente-2026-09), revisão: a PC perde `end_date`
// (só o Contrato grande, quando existe, tem prazo) e `start_date` vira
// opcional — não existe mais data obrigatória alguma na PC, então o refine de
// ordenação de datas (`end_date >= start_date`) saiu por completo, e a base
// pode ser usada direto tanto no create quanto no `.partial()` do update (o
// gap zod v4 .partial()+.refine() nunca chega a se aplicar aqui, ver
// supabase/migrations/027_fix_proposal_recurring_null.sql). `contract_id` é
// novo: vínculo opcional com o Contrato grande ao qual esta PC pertence,
// validado (mesmo client_id) na rota antes de gravar.
const proposalBodyBase = z.object({
  client_id: z.string().uuid('Cliente é obrigatório'),
  description: z.string().min(1).max(2000),
  start_date: z.string().min(1).optional(),
  contract_type: z.enum(['service', 'rental']).optional(),
  contract_value: z.number().min(0).optional(),
  recurring: z.boolean().default(false),
  file_url: z.string().optional(),
  contract_id: z.string().uuid().optional(),
})
const proposalBody = proposalBodyBase
const proposalBodyPartial = proposalBodyBase.partial()

// HIGH-05: schema de validação UUID para path params
const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

// Visão macro na tela da PC: embeda um resumo da OS gerada na aceitação
// (job_id só fica preenchido depois de aceita — nas demais, o embed abaixo
// vem null, sem custo extra de query) e do Contrato grande vinculado
// manualmente, quando houver (`contract_id`, sub-plano 01 — não é mais
// gerado automaticamente no aceite, por isso o embed fica enxuto, só pra
// identificar "qual contrato"). `employees` dentro de `jobs` precisa do hint
// `!fkey` porque job tem duas FKs possíveis pra employees (employee_id
// legado + job_employees) — mesmo achado já resolvido em jobs.ts.
const SELECT_PROPOSAL =
  'id, number, client_id, description, contract_type, contract_value, recurring, start_date, file_url, status, contract_id, job_id, created_at, updated_at, ' +
  'clients(id, razao_social, cnpj), ' +
  'contracts(id, number), ' +
  'jobs(id, number, status, scheduled_date, scheduled_end_date, city, state, employees!jobs_employee_id_fkey(name), machines(name))'

// Sub-plano 01: `contract_id` é opcional, mas quando informado precisa
// apontar pra um Contrato do MESMO cliente da PC — senão a PC apareceria
// vinculada a um contrato de outra empresa. Retorna a mensagem de erro (para
// 400) ou null se está tudo certo / contract_id não foi informado.
async function validateContractOwnership(
  db: Parameters<typeof recordAuditEvent>[0], clientId: string, contractId: string,
): Promise<string | null> {
  const { data: contract, error } = await db.from('contracts').select('id, client_id').eq('id', contractId).single()
  if (error || !contract) return 'Contrato vinculado não encontrado'
  if (contract.client_id !== clientId) return 'Contrato vinculado pertence a outro cliente'
  return null
}

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

  // GET /proposals — suporta ?clientId= e ?contractId= (query param não é
  // convertido pelo axios). `?contractId=` lista as PCs vinculadas a um
  // Contrato grande (sub-plano 01 — front pagina essa aba na tela do contrato).
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { clientId, contractId } = req.query as { clientId?: string; contractId?: string }
    let query = db.from('proposals').select(SELECT_PROPOSAL).order('created_at', { ascending: false })
    if (clientId) {
      query = query.eq('client_id', clientId)
    }
    if (contractId) {
      query = query.eq('contract_id', contractId)
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
    if (parsed.data.contract_id) {
      const ownershipError = await validateContractOwnership(db, parsed.data.client_id, parsed.data.contract_id)
      if (ownershipError) return reply.status(400).send({ error: ownershipError })
    }
    const { data, error } = await db.from('proposals').insert(parsed.data).select(SELECT_PROPOSAL).single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = proposalBodyPartial.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      if (parsed.data.contract_id) {
        // client_id pode não vir no PUT parcial — busca o da PC já gravada
        // pra validar o mesmo dono do contract_id informado.
        let effectiveClientId = parsed.data.client_id
        if (!effectiveClientId) {
          const { data: current } = await db.from('proposals').select('client_id').eq('id', req.params.id).single()
          effectiveClientId = current?.client_id
        }
        if (effectiveClientId) {
          const ownershipError = await validateContractOwnership(db, effectiveClientId, parsed.data.contract_id)
          if (ownershipError) return reply.status(400).send({ error: ownershipError })
        }
      }
      const { data, error } = await db.from('proposals')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select(SELECT_PROPOSAL).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // PATCH /proposals/:id/accept — cria SÓ a OS via RPC transacional
  // `accept_proposal` (ver supabase/migrations/030_pc_os_vinculo_direto.sql).
  // Sub-plano 01: aceitar não cria mais Contrato — a OS nasce vinculada
  // direto à PC (`jobs.proposal_id`) e ao cliente (`jobs.client_id`),
  // herdando `contract_id` só se a PC já tinha um contrato escolhido
  // (`proposals.contract_id`). A PC em si nunca muda de tabela, só de
  // `status` + vínculo com a OS (`job_id`).
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
      const result = data as { proposal: Record<string, unknown>; job: Record<string, unknown> }
      await recordProposalAuditEvent(db, {
        action: 'proposal.accepted',
        proposalId: req.params.id,
        actorId: (req as any).user.id,
        metadata: { jobId: result.job?.id, number: result.proposal?.number },
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
