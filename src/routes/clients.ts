import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireRoles } from '@/plugins/authorize'

const addressSchema = z.object({
  logradouro: z.string().min(1).max(200),
  numero: z.string().min(1).max(20),
  complemento: z.string().max(100).optional(),
  bairro: z.string().min(1).max(100),
  cidade: z.string().min(1).max(100),
  estado: z.string().length(2),
  cep: z.string().min(8).max(10),
})

const clientBody = z.object({
  razao_social: z.string().min(2).max(200),
  cnpj: z.string().min(14).max(18),
  segmento: z.string().min(1).max(100),
  email: z.string().email(),
  telefone: z.string().max(20).optional().nullable(),
  celular: z.string().max(20).optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active'),
  endereco: addressSchema,
})

const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const SELECT_CLIENT = 'id, razao_social, cnpj, segmento, email, telefone, celular, status, endereco, created_at, updated_at'

const clients: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /clients
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { search } = req.query as { search?: string }
    let query = db.from('clients').select(SELECT_CLIENT).order('razao_social')
    if (search) {
      query = query.or(`razao_social.ilike.%${search}%,cnpj.ilike.%${search}%`)
    }
    const { data, error } = await query
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /clients/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('clients')
        .select(SELECT_CLIENT)
        .eq('id', req.params.id)
        .single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // POST /clients
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = clientBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('clients').insert(parsed.data).select(SELECT_CLIENT).single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // PUT /clients/:id
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = clientBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('clients')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select(SELECT_CLIENT)
        .single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // DELETE /clients/:id (admin only)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, requireRoles('admin')], schema: { params: uuidParams } },
    async (req, reply) => {
      const { error } = await db.from('clients').delete().eq('id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      return reply.status(204).send()
    },
  )
}

export default clients
