import * as ragService from '@/services/rag.service'
import { chunkText } from '@/services/rag.service'
import { findCuratedAnswer } from '@/services/rag.curated.service'
import Anthropic from '@anthropic-ai/sdk'
import { VoyageAIClient } from 'voyageai'

jest.mock('@anthropic-ai/sdk')
jest.mock('voyageai')
jest.mock('@/services/rag.curated.service')

describe('chunkText', () => {
  it('divide texto em chunks de ~500 chars com sobreposição de ~50', () => {
    const text = 'A'.repeat(1200)
    const chunks = chunkText(text, 500, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].length).toBeLessThanOrEqual(510)
    // sobreposição: início do chunk[1] repete final do chunk[0]
    const overlap = chunks[0].slice(-50)
    expect(chunks[1].startsWith(overlap)).toBe(true)
  })

  it('retorna um único chunk se texto for curto', () => {
    const chunks = chunkText('texto curto', 500, 50)
    expect(chunks).toHaveLength(1)
  })
})

describe('answerQuestion — curated hit', () => {
  const mockSupabase: any = { rpc: jest.fn() }

  it('returns curated answer without calling Claude', async () => {
    const fakeEmbedding = Array(1024).fill(0.1)
    const mockVoyage = { embed: jest.fn().mockResolvedValue({ data: [{ embedding: fakeEmbedding }] }) }
    ;(VoyageAIClient as jest.Mock).mockImplementation(() => mockVoyage)
    ;(findCuratedAnswer as jest.Mock).mockResolvedValue('Resposta curada.')

    const result = await ragService.answerQuestion(mockSupabase, 'machine-1', 'Pergunta?')
    expect(result).toBe('Resposta curada.')
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('compareAcrossMachines', () => {
  const mockSupabase: any = { rpc: jest.fn() }

  it('returns a comparative answer from Claude', async () => {
    const fakeEmbedding = Array(1024).fill(0.1)
    const mockVoyage = { embed: jest.fn().mockResolvedValue({ data: [{ embedding: fakeEmbedding }] }) }
    ;(VoyageAIClient as jest.Mock).mockImplementation(() => mockVoyage)

    mockSupabase.rpc.mockResolvedValue({
      data: [
        { machine_id: 'machine-1', content: 'Pressão máx: 200 bar', similarity: 0.95 },
        { machine_id: 'machine-2', content: 'Pressão máx: 150 bar', similarity: 0.90 },
      ],
      error: null,
    })

    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Máquina 1 suporta mais pressão.' }],
    })
    ;(Anthropic as unknown as jest.Mock).mockImplementation(() => ({ messages: { create: mockCreate } }))

    const result = await ragService.compareAcrossMachines(
      mockSupabase,
      ['machine-1', 'machine-2'],
      'Qual máquina suporta maior pressão?'
    )
    expect(result).toBe('Máquina 1 suporta mais pressão.')
    expect(mockSupabase.rpc).toHaveBeenCalledWith('match_chunks_multi_machine', expect.any(Object))
  })

  it('throws if vector search fails', async () => {
    const fakeEmbedding = Array(1024).fill(0.1)
    const mockVoyage = { embed: jest.fn().mockResolvedValue({ data: [{ embedding: fakeEmbedding }] }) }
    ;(VoyageAIClient as jest.Mock).mockImplementation(() => mockVoyage)

    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })

    await expect(
      ragService.compareAcrossMachines(mockSupabase, ['m1', 'm2'], 'pergunta')
    ).rejects.toThrow('Vector search failed: DB error')
  })
})
