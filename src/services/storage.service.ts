import type { SupabaseClient } from '@supabase/supabase-js'

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
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
