import type { FastifyPluginAsync } from 'fastify'

const notifications: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    const { data, error } = await db.from('notifications')
      .select('*').eq('user_id', req.user.id).order('created_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return data
  })

  // PATCH /notifications/read-all — deve vir ANTES de /:id
  fastify.patch('/read-all', { onRequest: [guard] }, async (req: any, reply) => {
    const { error } = await db.from('notifications').update({ read: true }).eq('user_id', req.user.id)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(204).send()
  })

  // IDOR: faltava filtrar por user_id — qualquer autenticado marcava notificação
  // alheia como lida (achado da auditoria 2026-09-15).
  fastify.patch<{ Params: { id: string } }>('/:id/read', { onRequest: [guard] }, async (req: any, reply) => {
    const { data, error } = await db.from('notifications').update({ read: true })
      .eq('id', req.params.id).eq('user_id', req.user.id).select().single()
    if (error || !data) return reply.status(404).send({ error: 'Not found' })
    return data
  })
}

export default notifications
