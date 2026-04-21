import Groq from 'groq-sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

const GROQ_MODEL = 'llama-3.3-70b-versatile'

export async function getOrGenerateOverview(
  supabase: SupabaseClient,
  machineId: string
): Promise<string> {
  const { data: machine, error: mErr } = await supabase
    .from('machines')
    .select('pdf_hash, name')
    .eq('id', machineId)
    .single()
  if (mErr || !machine) throw new Error('Máquina não encontrada')
  if (!machine.pdf_hash) throw new Error('Manual não indexado para esta máquina')

  const { data: cached } = await supabase
    .from('machine_overviews')
    .select('content, pdf_hash')
    .eq('machine_id', machineId)
    .single()

  if (cached && cached.pdf_hash === machine.pdf_hash) return cached.content

  const { data: chunks, error: cErr } = await supabase
    .from('machine_chunks')
    .select('content')
    .eq('machine_id', machineId)
    .order('chunk_index', { ascending: true })
    .limit(20)
  if (cErr || !chunks?.length) throw new Error('Nenhum chunk encontrado para esta máquina')

  const context = (chunks as { content: string }[]).map((c) => c.content).join('\n\n---\n\n')

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'system',
        content: `Você é um assistente técnico especializado. Gere um overview estruturado do manual da máquina "${machine.name}" com as seções: **Especificações Principais**, **Manutenção Preventiva**, **Alertas de Segurança**, **Orientações do Fabricante**. Use apenas as informações do contexto fornecido.`,
      },
      { role: 'user', content: `Contexto do manual:\n${context}\n\nGere o overview estruturado.` },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('Resposta vazia do Groq')

  await supabase.from('machine_overviews').upsert(
    { machine_id: machineId, content, pdf_hash: machine.pdf_hash, generated_at: new Date().toISOString() },
    { onConflict: 'machine_id' }
  )

  return content
}
