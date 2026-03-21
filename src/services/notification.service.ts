import type { SupabaseClient } from '@supabase/supabase-js'

export async function insertNotification(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  message: string
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, message })
  if (error) console.error('Failed to insert notification:', error.message)
}
