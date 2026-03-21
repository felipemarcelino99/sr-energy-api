import fp from 'fastify-plugin'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient
  }
}

const supabasePlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  fastify.decorate('supabase', client)
}

export default fp(supabasePlugin)
