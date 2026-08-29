import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { history } from '@/services/audit-log.service'
import { isJobAssignedToEmployee } from '@/routes/jobs'

const entityType = z.enum(['contract', 'job'])

const listQuery = z.object({
  entityType,
  entityId: z.string().uuid(),
})

// Sub-plano 04, item 13 (frontend): linha do tempo do contrato/OS combina
// eventos do audit-log (transições de status, acesso a documento) com os
// documentos vinculados (nativos + legado) — este endpoint expõe só o lado do
// audit-log; o frontend combina com GET /documents (mesmos entityType/entityId).
const auditLog: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /audit-log?entityType=&entityId= — mesma checagem de ownership de OS
  // usada em documents.ts: employee só vê histórico de OS à qual está
  // atribuído (evita reabrir o achado de IDOR do sub-plano 01 por essa via).
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    if (req.user.role === 'employee' && parsed.data.entityType === 'job') {
      const { data: emp } = await db.from('employees').select('id').eq('user_id', req.user.id).single()
      if (!emp) return reply.status(404).send({ error: 'Not found' })
      const { data: job, error } = await db.from('jobs').select('id, employee_id').eq('id', parsed.data.entityId).single()
      if (error || !job) return reply.status(404).send({ error: 'Not found' })
      const owned = await isJobAssignedToEmployee(db, job.id, emp.id, job.employee_id)
      if (!owned) return reply.status(404).send({ error: 'Not found' })
    }

    const events = await history(db, parsed.data.entityType, parsed.data.entityId)
    return events
  })
}

export default auditLog
