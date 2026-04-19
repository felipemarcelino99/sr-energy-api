import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error: any, req, reply) => {
    req.log.error({ err: error, url: req.url, method: req.method }, 'Unhandled error')

    if (error.validation) {
      return reply.code(400).send({ error: 'Dados inválidos', details: error.message })
    }
    if (error.statusCode === 401) {
      return reply.code(401).send({ error: 'Não autorizado' })
    }
    if (error.statusCode === 403) {
      return reply.code(403).send({ error: 'Acesso negado' })
    }
    if (error.statusCode === 404) {
      return reply.code(404).send({ error: 'Não encontrado' })
    }
    // Nunca expor stack trace em produção
    return reply.code(500).send({ error: 'Erro interno do servidor' })
  })
}

export default fp(errorHandlerPlugin)
