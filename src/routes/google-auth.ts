import type { FastifyPluginAsync } from 'fastify'
import { getAuthUrl, exchangeCode } from '@/services/google-calendar.service'
import { generateState, verifyState } from '@/utils/oauth-state'
import { encrypt } from '@/utils/encrypt'

const googleAuthRoute: FastifyPluginAsync = async (fastify) => {
  const db = fastify.supabase
  const guard = (fastify as any).authenticate

  // GET /auth/google — gera URL de autorização (requer login)
  // CRIT-01: state agora é HMAC assinado com o userId
  fastify.get('/', { onRequest: [guard] }, async (req: any, reply) => {
    const state = generateState(req.user.id)
    const url = getAuthUrl(state)
    return reply.redirect(url)
  })

  // GET /auth/google/callback — troca code por tokens e salva
  // CRIT-01: verifica HMAC do state antes de qualquer operação
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    { onRequest: [guard] },
    async (req: any, reply) => {
      const { code, state, error } = req.query

      if (error || !code || !state) {
        return reply.redirect(`${process.env.FRONTEND_URL}/calendar?google=error`)
      }

      // CRIT-01: rejeitar callback com state inválido (CSRF protection)
      if (!verifyState(state, req.user.id)) {
        fastify.log.warn({ userId: req.user.id }, 'OAuth state verification failed')
        return reply.redirect(`${process.env.FRONTEND_URL}/calendar?google=error`)
      }

      const tokens = await exchangeCode(code)

      if (!tokens.refresh_token) {
        // Sem refresh_token: usuário já autorizou antes, token não é re-emitido
        // Precisa revogar acesso em https://myaccount.google.com/permissions e tentar novamente
        return reply.redirect(`${process.env.FRONTEND_URL}/calendar?google=no_refresh_token`)
      }

      // HIGH-02: criptografar refresh_token antes de persistir
      const encryptedToken = encrypt(tokens.refresh_token)

      const { error: dbError } = await db
        .from('employees')
        .update({ google_refresh_token: encryptedToken })
        .eq('user_id', req.user.id)

      if (dbError) {
        fastify.log.error(dbError, 'Failed to save google refresh token')
        return reply.redirect(`${process.env.FRONTEND_URL}/calendar?google=error`)
      }

      return reply.redirect(`${process.env.FRONTEND_URL}/calendar?google=connected`)
    },
  )
}

export default googleAuthRoute
