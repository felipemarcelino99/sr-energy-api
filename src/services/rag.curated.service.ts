import type { SupabaseClient } from '@supabase/supabase-js'

const SIMILARITY_THRESHOLD = 0.92

export async function findCuratedAnswer(
  supabase: SupabaseClient,
  machineId: string,
  queryEmbedding: number[]
): Promise<string | null> {
  const { data, error } = await supabase
    .from('rag_curated_answers')
    .select('answer, question_embedding')
    .eq('machine_id', machineId)
  if (error || !data || data.length === 0) return null

  let best: { answer: string; similarity: number } | null = null
  for (const row of data as { answer: string; question_embedding: number[] }[]) {
    const sim = cosineSimilarity(queryEmbedding, row.question_embedding)
    if (sim > SIMILARITY_THRESHOLD && (!best || sim > best.similarity)) {
      best = { answer: row.answer, similarity: sim }
    }
  }
  return best?.answer ?? null
}

export async function saveCuratedAnswer(
  supabase: SupabaseClient,
  machineId: string,
  question: string,
  questionEmbedding: number[],
  answer: string,
  userId: string
): Promise<void> {
  const { error } = await supabase.from('rag_curated_answers').insert({
    machine_id: machineId,
    question,
    question_embedding: questionEmbedding,
    answer,
    created_by: userId,
  })
  if (error) throw new Error(`Failed to save curated answer: ${error.message}`)
}

export async function deleteCuratedAnswer(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('rag_curated_answers')
    .delete()
    .eq('id', id)
  if (error) throw new Error(`Failed to delete curated answer: ${error.message}`)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
