import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const txBody = z.object({
  type: z.enum(['credit', 'debit']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().min(1),
  category: z.string().min(1),
  destination: z.string().optional(),
  date: z.string().min(1),
})

const transactions: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('transactions').select('*').order('date', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = txBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('transactions').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('transactions').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })
}

export default transactions
