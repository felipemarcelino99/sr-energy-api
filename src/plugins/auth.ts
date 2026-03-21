import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { Role } from '@/types'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>
  }
  interface FastifyRequest {
    user: { id: string; email: string; role: Role; name: string }
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw { statusCode: 401, message: 'No Authorization was found in request.headers' }
    }
    const token = authHeader.slice(7)
    const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
    if (error || !user) {
      throw { statusCode: 401, message: 'Unauthorized' }
    }
    req.user = {
      id: user.id,
      email: user.email!,
      role: (user.user_metadata?.role ?? 'employee') as Role,
      name: user.user_metadata?.name ?? user.email!,
    }
  })
}

export default fp(authPlugin)
