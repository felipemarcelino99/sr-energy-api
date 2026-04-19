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

    // MED-08: Validar claim `aud`
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      if (payload.aud !== 'authenticated') {
        throw { statusCode: 401, message: 'Unauthorized' }
      }
    } catch (e: any) {
      if (e.statusCode) throw e
      throw { statusCode: 401, message: 'Unauthorized' }
    }

    const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
    if (error || !user) {
      throw { statusCode: 401, message: 'Unauthorized' }
    }

    // CRIT-02: Buscar role da tabela user_roles (não de user_metadata)
    const { data: roleRow } = await fastify.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    req.user = {
      id: user.id,
      email: user.email!,
      role: ((roleRow?.role) ?? 'employee') as Role,
      name: user.user_metadata?.name ?? user.email!,
    }
  })
}

export default fp(authPlugin)
