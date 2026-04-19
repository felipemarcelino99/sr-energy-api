import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Role } from '@/types'

// HIGH-01: middleware de autorização por role
export function requireRoles(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Acesso negado' })
    }
  }
}
