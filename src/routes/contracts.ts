import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { requireRoles } from '@/plugins/authorize'

// HIGH-06: whitelist de campos
const contractBody = z.object({
  client_name: z.string().min(2).max(200),
  client_cnpj: z.string().min(14).max(18),
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

// HIGH-07: verificação de magic bytes sem dependência externa
const ALLOWED_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg',      bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4E, 0x47] },
]

function detectMimeFromBuffer(buf: Buffer): string | null {
  for (const sig of ALLOWED_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime
  }
  return null
}

const contracts: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /contracts/expiring — deve vir ANTES de /:id
  fastify.get('/expiring', { onRequest: [guard] }, async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    // MED-04: select explícito
    const { data, error } = await db.from('contracts')
      .select('id, client_name, client_cnpj, description, start_date, end_date, contract_type, contract_value, recurring, file_url, created_at, updated_at')
      .gte('end_date', today).lte('end_date', in30).order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    // MED-04: select explícito
    const { data, error } = await db.from('contracts')
      .select('id, client_name, client_cnpj, description, start_date, end_date, contract_type, contract_value, recurring, file_url, created_at, updated_at')
      .order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('contracts')
        .select('id, client_name, client_cnpj, description, start_date, end_date, contract_type, contract_value, recurring, file_url, created_at, updated_at')
        .eq('id', req.params.id).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // HIGH-01: apenas admin ou manager podem criar/editar/deletar contratos
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = contractBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('contracts')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single()
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

      // HIGH-07: verificar magic bytes reais do arquivo
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
