import type { SupabaseClient } from '@supabase/supabase-js'

// Buckets que guardam documentos sensíveis (contratos, certificados de calibração,
// evidências de relatório). CRITICAL/HIGH-06 (sub-plano 01): esses buckets não podem
// expor URL pública permanente — usamos createSignedUrl com TTL curto.
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1h — tempo suficiente para o front consumir a URL

const SIGNED_BUCKETS = new Set(['contract-files', 'bag-certificates', 'evidences'])

export async function uploadFile(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType, upsert: true,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  if (SIGNED_BUCKETS.has(bucket)) {
    return getSignedUrl(supabase, bucket, path)
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

// CRITICAL/HIGH-06: gera uma URL assinada com TTL curto em vez de expor o objeto
// publicamente para sempre. Deve ser chamada de novo (não só uma vez no upload)
// sempre que o front precisar renovar acesso a um arquivo já existente.
export async function getSignedUrl(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
  if (error || !data) throw new Error(`Storage signed URL failed: ${error?.message ?? 'unknown error'}`)
  return data.signedUrl
}
