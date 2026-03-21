import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { answerQuestion } from '@/services/rag.service'

const chatBody = z.object({
  machineId: z.string().min(1, 'Selecione uma máquina'),
  message: z.string().min(1, 'Mensagem não pode estar vazia'),
})

const chat: FastifyPluginAsync = async (fastify) => {
  const guard = (fastify as any).authenticate

  fastify.post('/', { onRequest: [guard] }, async (req, reply) => {
    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    try {
      const answer = await answerQuestion(fastify.supabase, parsed.data.machineId, parsed.data.message)
      return { answer }
    } catch (err: any) {
      if (err.message?.includes('não indexado')) return reply.status(404).send({ error: err.message })
      return reply.status(502).send({ error: 'Erro ao consultar a IA. Tente novamente.' })
    }
  })
}

export default chat
