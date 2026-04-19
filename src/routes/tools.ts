import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const toolBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  quantity: z.coerce.number().int().min(0),
})

const tools: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /tools
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    let query = db.from('tools').select('*').order('name')
    const { status } = req.query as { status?: string }
    if (status) query = (query as any).eq('status', status)
    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /tools/:id
  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('tools').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // POST /tools
  fastify.post('/', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = toolBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('tools').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // PUT /tools/:id
  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const parsed = toolBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('tools')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  // DELETE /tools/:id — soft delete (inactive)
  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req: any, reply) => {
    if (!['manager', 'admin'].includes(req.user.role))
      return reply.status(403).send({ error: 'Forbidden' })
    const { data, error } = await db.from('tools')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return reply.status(204).send()
  })
}

export default tools
