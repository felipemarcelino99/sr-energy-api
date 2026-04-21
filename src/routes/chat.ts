import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { answerQuestion, compareAcrossMachines, embedTexts } from '@/services/rag.service'
import { saveCuratedAnswer, deleteCuratedAnswer } from '@/services/rag.curated.service'

const chatBody = z.object({
  machineId: z.string().min(1, 'Selecione uma máquina'),
  message: z.string().min(1, 'Mensagem não pode estar vazia'),
})

const compareBody = z.object({
  machineIds: z.array(z.string().min(1)).min(2, 'Selecione ao menos 2 máquinas'),
  message: z.string().min(1, 'Mensagem não pode estar vazia'),
})

const curateBody = z.object({
  machineId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
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

  fastify.post('/compare', { onRequest: [guard] }, async (req, reply) => {
    const parsed = compareBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    try {
      const answer = await compareAcrossMachines(fastify.supabase, parsed.data.machineIds, parsed.data.message)
      return { answer }
    } catch (err: any) {
      return reply.status(502).send({ error: 'Erro ao consultar a IA. Tente novamente.' })
    }
  })

  fastify.post('/curate', { onRequest: [guard] }, async (req: any, reply) => {
    const parsed = curateBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    try {
      const [questionEmbedding] = await embedTexts([parsed.data.question])
      await saveCuratedAnswer(
        fastify.supabase,
        parsed.data.machineId,
        parsed.data.question,
        questionEmbedding,
        parsed.data.answer,
        req.user.id
      )
      return reply.status(201).send({ ok: true })
    } catch (err: any) {
      return reply.status(500).send({ error: 'Erro ao salvar resposta.' })
    }
  })

  fastify.delete<{ Params: { id: string } }>('/curate/:id', { onRequest: [guard] }, async (req: any, reply) => {
    if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Acesso negado' })
    try {
      await deleteCuratedAnswer(fastify.supabase, req.params.id)
      return reply.status(204).send()
    } catch (err: any) {
      return reply.status(500).send({ error: 'Erro ao remover resposta.' })
    }
  })
}

export default chat
