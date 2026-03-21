import { chunkText } from '@/services/rag.service'

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
