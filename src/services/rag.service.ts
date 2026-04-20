import pdfParse from 'pdf-parse'
import Anthropic from '@anthropic-ai/sdk'
import { VoyageAIClient } from 'voyageai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findCuratedAnswer } from '@/services/rag.curated.service'

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
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY })
  const result = await voyage.embed({ input: texts, model: EMBEDDING_MODEL })
  return (result.data as { embedding: number[] }[]).map((d) => d.embedding)
}

/** Indexa um documento de uma máquina (chamado após upload) */
export async function indexMachineManual(
  supabase: SupabaseClient,
  machineId: string,
  documentId: string,
  pdfBuffer: Buffer
): Promise<void> {
  const text = await extractText(pdfBuffer)
  const chunks = chunkText(text)
  const embeddings = await embedTexts(chunks)

  // Remove chunks antigos apenas deste documento
  await supabase.from('machine_chunks').delete().eq('document_id', documentId)

  const rows = chunks.map((content, i) => ({
    machine_id: machineId,
    document_id: documentId,
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

  // 2. Verificar resposta curada
  const curated = await findCuratedAnswer(supabase, machineId, queryEmbedding)
  if (curated) return curated

  // 3. Buscar top-5 chunks via pgvector
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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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

/** Busca chunks de múltiplas máquinas e retorna resposta comparativa */
export async function compareAcrossMachines(
  supabase: SupabaseClient,
  machineIds: string[],
  question: string
): Promise<string> {
  const [queryEmbedding] = await embedTexts([question])

  const { data: chunks, error } = await supabase.rpc('match_chunks_multi_machine', {
    p_machine_ids: machineIds,
    p_embedding: queryEmbedding,
    p_limit_per: 5,
  })
  if (error) throw new Error(`Vector search failed: ${error.message}`)

  const byMachine = new Map<string, string[]>()
  for (const chunk of (chunks as { machine_id: string; content: string }[])) {
    if (!byMachine.has(chunk.machine_id)) byMachine.set(chunk.machine_id, [])
    byMachine.get(chunk.machine_id)!.push(chunk.content)
  }

  const machinesWithNoData = machineIds.filter((id) => !byMachine.has(id))

  let context = ''
  for (const [machineId, contents] of byMachine) {
    context += `=== Máquina ${machineId} ===\n${contents.join('\n\n')}\n\n`
  }
  if (machinesWithNoData.length > 0) {
    context += `\nNota: as seguintes máquinas não possuem manual indexado: ${machinesWithNoData.join(', ')}`
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `Você é um assistente técnico especializado. Compare as informações das máquinas com base nos manuais fornecidos. Se alguma máquina não tiver dados, mencione isso na resposta.`,
    messages: [{ role: 'user', content: `${context}\n\nPergunta: ${question}` }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}
