import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'
import { requireRoles } from '@/plugins/authorize'

const bagBody = z.object({
  name: z.string().min(2).max(200),
  model: z.string().min(1).max(200),
  quantity: z.number().int().min(1),
})

const uuidParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

const certParams = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    certId: { type: 'string', format: 'uuid' },
  },
  required: ['id', 'certId'],
} as const

const ALLOWED_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg',      bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4E, 0x47] },
]

function detectMimeFromBuffer(buf: Buffer): string | null {
  for (const sig of ALLOWED_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime
  }
  return null
}

const SELECT_BAG = 'id, name, model, quantity, created_at, updated_at, calibration_certificates(id, file_url, expiry_date)'

const bags: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate
  const adminOrManager = requireRoles('admin', 'manager')

  // GET /bags
  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('bags')
      .select(SELECT_BAG)
      .order('name')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // GET /bags/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard], schema: { params: uuidParams } },
    async (req, reply) => {
      const { data, error } = await db.from('bags')
        .select(SELECT_BAG)
        .eq('id', req.params.id)
        .single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // POST /bags
  fastify.post('/', { onRequest: [guard, adminOrManager] }, async (req, reply) => {
    const parsed = bagBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('bags').insert(parsed.data).select(SELECT_BAG).single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // PUT /bags/:id
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parsed = bagBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
      const { data, error } = await db.from('bags')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select(SELECT_BAG)
        .single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // DELETE /bags/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [guard, requireRoles('admin')], schema: { params: uuidParams } },
    async (req, reply) => {
      const { error } = await db.from('bags').delete().eq('id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      return reply.status(204).send()
    },
  )

  // POST /bags/:id/certificates — upload calibration certificate
  fastify.post<{ Params: { id: string } }>(
    '/:id/certificates',
    { onRequest: [guard, adminOrManager], schema: { params: uuidParams } },
    async (req, reply) => {
      const parts = req.parts()
      let fileBuffer: Buffer | null = null
      let fileMime: string | null = null
      let expiryDate: string | null = null

      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer()
          fileMime = detectMimeFromBuffer(fileBuffer)
        } else if (part.fieldname === 'expiryDate') {
          expiryDate = (part as any).value as string
        }
      }

      if (!fileBuffer) return reply.status(400).send({ error: 'Arquivo não enviado' })
      if (!fileMime) return reply.status(400).send({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG ou PNG.' })
      if (!expiryDate) return reply.status(400).send({ error: 'Data de vencimento obrigatória' })

      const certId = crypto.randomUUID()
      const ext = fileMime === 'application/pdf' ? 'pdf' : fileMime === 'image/jpeg' ? 'jpg' : 'png'
      const url = await uploadFile(
        fastify.supabase,
        'bag-certificates',
        `${req.params.id}/${certId}.${ext}`,
        fileBuffer,
        fileMime,
      )

      const { error: insertError } = await db.from('calibration_certificates').insert({
        id: certId,
        bag_id: req.params.id,
        file_url: url,
        expiry_date: expiryDate,
      })
      if (insertError) return reply.status(500).send({ error: insertError.message })

      const { data, error } = await db.from('bags').select(SELECT_BAG).eq('id', req.params.id).single()
      if (error || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )

  // DELETE /bags/:id/certificates/:certId
  fastify.delete<{ Params: { id: string; certId: string } }>(
    '/:id/certificates/:certId',
    { onRequest: [guard, adminOrManager], schema: { params: certParams } },
    async (req, reply) => {
      const { error } = await db.from('calibration_certificates')
        .delete()
        .eq('id', req.params.certId)
        .eq('bag_id', req.params.id)
      if (error) return reply.status(500).send({ error: error.message })
      const { data, error: fetchError } = await db.from('bags').select(SELECT_BAG).eq('id', req.params.id).single()
      if (fetchError || !data) return reply.status(404).send({ error: 'Not found' })
      return data
    },
  )
}

export default bags
