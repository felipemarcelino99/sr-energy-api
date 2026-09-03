import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditEvent {
  entityType: string // 'contract' | 'job' | 'proposal' (livre para outras entidades futuras)
  entityId: string
  actorId: string
  action: string
  metadata?: Record<string, unknown>
}

// Best-effort: falha ao gravar auditoria nunca deve derrubar o fluxo principal
// (transição de contrato/OS, acesso a documento) — só loga o erro.
export async function record(db: SupabaseClient, event: AuditEvent): Promise<void> {
  const { error } = await db.from('audit_log').insert({
    entity_type: event.entityType,
    entity_id: event.entityId,
    actor_id: event.actorId,
    action: event.action,
    metadata: event.metadata ?? null,
  })
  if (error) {
    console.error(`audit-log: failed to record "${event.action}" for ${event.entityType}:${event.entityId}: ${error.message}`)
  }
}

export async function history(
  db: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('audit_log')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`audit-log: failed to load history: ${error.message}`)
  return data ?? []
}
