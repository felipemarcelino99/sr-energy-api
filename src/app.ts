import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import supabasePlugin from '@/plugins/supabase'
import authPlugin from '@/plugins/auth'
import employeesRoute from '@/routes/employees'
import machinesRoute from '@/routes/machines'
import contractsRoute from '@/routes/contracts'
import jobsRoute from '@/routes/jobs'
import reportsRoute from '@/routes/reports'
import transactionsRoute from '@/routes/transactions'
import notificationsRoute from '@/routes/notifications'
import chatRoute from '@/routes/chat'

export function buildApp() {
  const app = Fastify({ logger: { level: 'info' } })

  app.register(cors, { origin: process.env.FRONTEND_URL ?? '*' })
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }) // 50MB
  app.register(supabasePlugin)
  app.register(authPlugin)

  // Routes
  app.register(employeesRoute, { prefix: '/employees' })
  app.register(machinesRoute, { prefix: '/machines' })
  app.register(contractsRoute, { prefix: '/contracts' })
  app.register(jobsRoute, { prefix: '/jobs' })
  app.register(reportsRoute)
  app.register(transactionsRoute, { prefix: '/transactions' })
  app.register(notificationsRoute, { prefix: '/notifications' })
  app.register(chatRoute, { prefix: '/chat' })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
