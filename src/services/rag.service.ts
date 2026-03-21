import pdfParse from 'pdf-parse'
import Anthropic from '@anthropic-ai/sdk'
import { VoyageAIClient } from 'voyageai'
import type { SupabaseClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY })

const EMBEDDING_MODEL = 'voyage-3'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50

/** Divide texto em chunks sobrepostos */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + size))
    start += size - overlap
  }
  return chunks
}

/** Extrai texto de um buffer PDF */
async function extractText(pdfBuffer: Buffer): Promise<string> {
  const result = await pdfParse(pdfBuffer)
  if (!result.text.trim()) throw new Error('PDF não contém texto extraível')
  return result.text
}

/** Embeda um array de strings via Voyage AI */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const result = await voyage.embed({ input: texts, model: EMBEDDING_MODEL })
  return (result.data as { embedding: number[] }[]).map((d) => d.embedding)
}

/** Indexa o manual de uma máquina (chamado após upload) */
export async function indexMachineManual(
  supabase: SupabaseClient,
  machineId: string,
  pdfBuffer: Buffer
): Promise<void> {
  const text = await extractText(pdfBuffer)
  const chunks = chunkText(text)
  const embeddings = await embedTexts(chunks)

  // Remove chunks antigos da máquina
  await supabase.from('machine_chunks').delete().eq('machine_id', machineId)

  // Upsert novos chunks
  const rows = chunks.map((content, i) => ({
    machine_id: machineId,
    content,
    embedding: embeddings[i],
    chunk_index: i,
  }))
  const { error } = await supabase.from('machine_chunks').insert(rows)
  if (error) throw new Error(`Failed to index chunks: ${error.message}`)
}

/** Responde uma pergunta sobre uma máquina usando RAG + Claude */
export async function answerQuestion(
  supabase: SupabaseClient,
  machineId: string,
  question: string
): Promise<string> {
  // 1. Embed a pergunta
  const [queryEmbedding] = await embedTexts([question])

  // 2. Buscar top-5 chunks via pgvector
  const { data: chunks, error } = await supabase.rpc('match_machine_chunks', {
    p_machine_id: machineId,
    p_embedding: queryEmbedding,
    p_limit: 5,
  })
  if (error) throw new Error(`Vector search failed: ${error.message}`)
  if (!chunks || chunks.length === 0)
    throw new Error('Manual não indexado para esta máquina')

  const context = (chunks as { content: string }[]).map((c) => c.content).join('\n\n---\n\n')

  // 3. Chamar Claude
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `Você é um assistente técnico especializado. Responda APENAS com base no contexto do manual fornecido. Se a resposta não estiver no contexto, diga "Não encontrei essa informação no manual."`,
    messages: [
      { role: 'user', content: `Contexto do manual:\n${context}\n\nPergunta: ${question}` },
    ],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}
