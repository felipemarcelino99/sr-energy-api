import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { uploadFile } from '@/services/storage.service'

const contractBody = z.object({
  client_name: z.string().min(2),
  client_cnpj: z.string().min(14),
  description: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
}).refine(d => new Date(d.end_date) >= new Date(d.start_date), {
  message: 'end_date must be after start_date', path: ['end_date'],
})

const contracts: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /contracts/expiring — deve vir ANTES de /:id
  fastify.get('/expiring', { onRequest: [guard] }, async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('contracts').select('*')
      .gte('end_date', today).lte('end_date', in30).order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get('/', { onRequest: [guard] }, async (_req, reply) => {
    const { data, error } = await db.from('contracts').select('*').order('end_date')
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  fastify.get<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { data, error } = await db.from('contracts').select('*').eq('id', req.params.id).single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').insert(parsed.data).select().single()
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  fastify.put<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const parsed = contractBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { data, error } = await db.from('contracts').update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { onRequest: [guard] }, async (req, reply) => {
    const { error } = await db.from('contracts').delete().eq('id', req.params.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  fastify.post<{ Params: { id: string } }>('/:id/file', { onRequest: [guard] }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: 'Arquivo não enviado' })
    const buffer = await file.toBuffer()
    const url = await uploadFile(fastify.supabase, 'contract-files', `${req.params.id}.pdf`, buffer, 'application/pdf')
    await db.from('contracts').update({ file_url: url, updated_at: new Date().toISOString() }).eq('id', req.params.id)
    return { url }
  })
}

export default contracts
