import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import supabasePlugin from '@/plugins/supabase'
import authPlugin from '@/plugins/auth'
import errorHandlerPlugin from '@/plugins/error-handler'
import employeesRoute from '@/routes/employees'
import machinesRoute from '@/routes/machines'
import contractsRoute from '@/routes/contracts'
import jobsRoute from '@/routes/jobs'
import reportsRoute from '@/routes/reports'
import transactionsRoute from '@/routes/transactions'
import notificationsRoute from '@/routes/notifications'
import chatRoute from '@/routes/chat'
import scheduleEventsRoute from '@/routes/schedule-events'
import googleAuthRoute from '@/routes/google-auth'
import toolsRoute from '@/routes/tools'
import bagsRoute from '@/routes/bags'
import clientsRoute from '@/routes/clients'

export function buildApp() {
  // HIGH-03: FRONTEND_URL obrigatória em produção
  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    throw new Error('FRONTEND_URL env var is required in production')
  }

  const app = Fastify({ logger: { level: 'info' } })

  // HIGH-04: Security headers
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  })

  // HIGH-03: CORS sem wildcard
  app.register(cors, {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  // HIGH-08: Rate limiting global
  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }) // 50MB
  app.register(supabasePlugin)
  app.register(authPlugin)
  app.register(errorHandlerPlugin)

  // Routes
  app.register(employeesRoute, { prefix: '/employees' })
  app.register(machinesRoute, { prefix: '/machines' })
  app.register(contractsRoute, { prefix: '/contracts' })
  app.register(jobsRoute, { prefix: '/jobs' })
  app.register(reportsRoute)
  app.register(transactionsRoute, { prefix: '/transactions' })
  app.register(notificationsRoute, { prefix: '/notifications' })
  app.register(chatRoute, { prefix: '/chat' })
  app.register(scheduleEventsRoute, { prefix: '/schedule-events' })
  app.register(googleAuthRoute, { prefix: '/auth/google' })
  app.register(toolsRoute, { prefix: '/tools' })
  app.register(bagsRoute, { prefix: '/bags' })
  app.register(clientsRoute, { prefix: '/clients' })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
