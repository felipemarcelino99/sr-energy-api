import Fastify from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'

// Mock Supabase client injetado nos testes
export const mockSupabase: any = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  order: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  storage: { from: jest.fn() },
  rpc: jest.fn(),
  auth: { admin: { createUser: jest.fn() } },
}

export function buildApp() {
  const app = Fastify({ logger: false })
  app.decorate('supabase', mockSupabase as unknown as SupabaseClient)
  app.decorateRequest('user', '' as any)
  // Noop authenticate — routes use it as onRequest guard, bypassed via x-test-user header
  app.decorate('authenticate', async () => {})
  // Bypass auth in tests: set user from header x-test-user
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-test-user']
    if (raw) req.user = JSON.parse(raw as string)
  })
  return app
}
