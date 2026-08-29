import type { SupabaseClient } from '@supabase/supabase-js'
import { getSignedUrl } from '@/services/storage.service'
import { record as recordAuditEvent } from '@/services/audit-log.service'

export type DocumentEntityType = 'contract' | 'job'

export interface DocumentRow {
  id: string
  entity_type: DocumentEntityType
  entity_id: string
  storage_kind: 'internal' | 'drive_link'
  bucket: string | null
  path: string | null
  drive_url: string | null
  note: string | null
  label: string | null
  created_by: string
  created_at: string
}

// Item 6: documento nativo do portal (relatório gerado, arquivo enviado por um
// colaborador etc.) — guardado no Storage do Supabase, sempre em bucket com
// signed URL (reaproveita a correção do achado CRITICAL/HIGH-06 de storage.service).
export async function attachDocument(
  db: SupabaseClient,
  params: { entityType: DocumentEntityType; entityId: string; bucket: string; path: string; actorId: string; label?: string },
): Promise<DocumentRow> {
  const { data, error } = await db.from('documents').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    storage_kind: 'internal',
    bucket: params.bucket,
    path: params.path,
    label: params.label ?? null,
    created_by: params.actorId,
  }).select().single()
  if (error) throw new Error(`documents: failed to attach: ${error.message}`)

  await recordAuditEvent(db, {
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: params.actorId,
    action: 'document.attached',
    metadata: { documentId: data.id, storageKind: 'internal' },
  })
  return data as DocumentRow
}

// Item 7: vincula um documento do acervo legado do Drive — não migra o
// arquivo, só a URL. `note` é obrigatório (motivo/contexto do vínculo).
export async function linkLegacyDocument(
  db: SupabaseClient,
  params: { entityType: DocumentEntityType; entityId: string; driveUrl: string; note: string; actorId: string; label?: string },
): Promise<DocumentRow> {
  const { data, error } = await db.from('documents').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    storage_kind: 'drive_link',
    drive_url: params.driveUrl,
    note: params.note,
    label: params.label ?? null,
    created_by: params.actorId,
  }).select().single()
  if (error) throw new Error(`documents: failed to link legacy document: ${error.message}`)

  await recordAuditEvent(db, {
    entityType: params.entityType,
    entityId: params.entityId,
    actorId: params.actorId,
    action: 'document.linked',
    metadata: { documentId: data.id, storageKind: 'drive_link', note: params.note },
  })
  return data as DocumentRow
}

export async function listDocuments(
  db: SupabaseClient,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<DocumentRow[]> {
  const { data, error } = await db.from('documents')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`documents: failed to list: ${error.message}`)
  return (data ?? []) as DocumentRow[]
}

// Separado de resolveDocumentUrl para a rota poder checar ownership (employee
// só acessa documento de job próprio) ANTES de gerar a signed URL / logar
// acesso — ver R-IDOR.2 (nunca resolver o recurso e só depois decidir se pode).
export async function getDocumentById(db: SupabaseClient, documentId: string): Promise<DocumentRow | null> {
  const { data, error } = await db.from('documents').select('*').eq('id', documentId).single()
  if (error || !data) return null
  return data as DocumentRow
}

// Toda chamada aqui loga acesso no audit-log — inclusive para drive_link, cujo
// controle de acesso real é do Drive, não deste sistema (só registramos que
// alguém consumiu o vínculo por aqui).
export async function resolveDocumentUrl(db: SupabaseClient, doc: DocumentRow, actorId: string): Promise<string> {
  const url = doc.storage_kind === 'internal'
    ? await getSignedUrl(db, doc.bucket as string, doc.path as string)
    : (doc.drive_url as string)

  await recordAuditEvent(db, {
    entityType: doc.entity_type,
    entityId: doc.entity_id,
    actorId,
    action: 'document.accessed',
    metadata: { documentId: doc.id, storageKind: doc.storage_kind },
  })
  return url
}

export async function getDocumentUrl(
  db: SupabaseClient,
  documentId: string,
  actorId: string,
): Promise<string | null> {
  const doc = await getDocumentById(db, documentId)
  if (!doc) return null
  return resolveDocumentUrl(db, doc, actorId)
}
