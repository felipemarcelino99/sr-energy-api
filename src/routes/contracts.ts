import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { requireRoles } from '@/plugins/authorize'
import { detectMimeFromBuffer } from '@/utils/file-signature'

// HIGH-06: whitelist de campos
const contractBody = z.object({
  client_id: z.string().uuid('Cliente é obrigatório'),
  description: z.string().min(1).max(2000),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  contract_type: z.enum(['service', 'rental']).optional(),
  contract_value: z.number().min(0).optional(),
  recurring: z.boolean().optional(),
}).refine(d => new Date(d.end_date) >= new Date(d.start_date), {
  message: 'end_date must be after start_date', path: ['end_date'],
})

// HIGH-05: schema de validação UUID para path params
const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const SELECT_CONTRACT = 'id, client_id, description, start_date, end_date, contract_type, contract_value, recurring, file_url, created_at, updated_at, clients(id, razao_social, cnpj)'

const contracts: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /contracts/expiring — deve vir ANTES de /:id
  fastify.get('/expiring', { onRequest: [guard] }, async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('contracts')
      .select(SELECT_CONTRACT)
      .gte('end_date', today).lte('end_date', in30).order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /contracts — suporta ?clientId= (query param não é convertido pelo axios)
  fastify.get('/', { onRequest: [guard] }, async (req, reply) => {
    const { clientId } = req.query as { clientId?: string }
    let query = db.from('contracts').select(SELECT_CONTRACT).order('end_date')
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
      const { data, error } = await db.from('contracts')
        .select(SELECT_CONTRACT)
        .eq('id', req.params.id).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // HIGH-01: apenas admin ou manager podem criar/editar/deletar contratos
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').insert(parsed.data).select(SELECT_CONTRACT).single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = contractBody.partial().safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('contracts')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select(SELECT_CONTRACT).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, requireRoles('admin')], schema: { params: uuidParams } },
    async (req, reply) => {
      const { error } = await db.from('contracts').delete().eq('id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      return reply.status(204).send()
    },
  )

  // HIGH-07: magic bytes + HIGH-01: admin ou manager
  fastify.post<{ Params: { id: string } }>(
    '/:id/file',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const file = await req.file()
      if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
      const buffer = await file.toBuffer()

      const detectedMime = detectMimeFromBuffer(buffer)
      if (!detectedMime) {
        return reply.status(400).send({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG ou PNG.' })
      }

      const url = await uploadFile(fastify.supabase, 'contract-files', `${req.params.id}.pdf`, buffer, detectedMime)
      await db.from('contracts').update({ file_url: url, updated_at: new Date().toISOString() }).eq('id', req.params.id)
      return { url }
    },
  )
}

export default contracts
