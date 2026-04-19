import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireRoles } from '@/plugins/authorize'

// HIGH-06: whitelist explícita de campos
const txBody = z.object({
  type: z.enum(['credit', 'debit']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(100),
  destination: z.string().max(200).optional(),
  date: z.string().min(1),
})

// HIGH-05: schema UUID para path params
const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const transactions: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // HIGH-01: admin e manager acessam transações financeiras
  fastify.get('/', { onRequest: [guard, adminOrManager] }, async (_req, reply) => {
    // MED-04: select explícito
    const { data, error } = await db.from('transactions')
      .select('id, type, amount, description, category, destination, date, created_at')
      .order('date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = txBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('transactions').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const { error } = await db.from('transactions').delete().eq('id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      return reply.status(204).send()
    },
  )
}

export default transactions
