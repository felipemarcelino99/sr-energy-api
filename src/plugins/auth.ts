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

// item 6: cache curto de role por usuário para evitar bater em `user_roles`
// em toda requisição autenticada. Roles mudam raramente (promoção/rebaixamento
// de um funcionário), então um TTL curto é um trade-off aceitável entre
// performance e "tempo até a mudança de role propagar" — pior caso: até
// ROLE_CACHE_TTL_MS de atraso para uma role revogada parar de valer.
const ROLE_CACHE_TTL_MS = 60_000
const roleCache = new Map<string, { role: Role; expiresAt: number }>()

function getCachedRole(userId: string): Role | undefined {
  const entry = roleCache.get(userId)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    roleCache.delete(userId)
    return undefined
  }
  return entry.role
}

function setCachedRole(userId: string, role: Role): void {
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
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

    // CRIT-02: Buscar role da tabela user_roles (não de user_metadata).
    // item 6: usa cache curto em memória para evitar essa query em toda
    // requisição autenticada — só bate no banco quando expira ou nunca foi lida.
    let role = getCachedRole(user.id)
    if (!role) {
      const { data: roleRow } = await fastify.supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()
      role = ((roleRow?.role) ?? 'employee') as Role
      setCachedRole(user.id, role)
    }

    req.user = {
      id: user.id,
      email: user.email!,
      role,
      name: user.user_metadata?.name ?? user.email!,
    }
  })
}

export default fp(authPlugin)
