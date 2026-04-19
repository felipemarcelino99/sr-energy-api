import {
  findCuratedAnswer,
  saveCuratedAnswer,
  deleteCuratedAnswer,
} from '@/services/rag.curated.service'

const makeSupabase = (overrides: any = {}): any => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  ...overrides,
})

function makeEmbedding(value: number): number[] {
  return Array(1024).fill(value)
}

describe('findCuratedAnswer', () => {
  it('returns the answer when cosine similarity exceeds 0.92', async () => {
    const embedding = makeEmbedding(1)
    const supabase = makeSupabase()
    supabase.eq.mockResolvedValue({
      data: [{ answer: 'Resposta correta', question_embedding: makeEmbedding(1) }],
      error: null,
    })

    const result = await findCuratedAnswer(supabase, 'machine-1', embedding)
    expect(result).toBe('Resposta correta')
  })

  it('returns null when similarity is below threshold', async () => {
    const queryEmbedding = makeEmbedding(1)
    const supabase = makeSupabase()
    const orthogonal = Array(1024).fill(0)
    orthogonal[0] = 1
    orthogonal[1] = -1
    supabase.eq.mockResolvedValue({
      data: [{ answer: 'Irrelevante', question_embedding: orthogonal }],
      error: null,
    })

    const result = await findCuratedAnswer(supabase, 'machine-1', queryEmbedding)
    expect(result).toBeNull()
  })

  it('returns null when no curated answers exist', async () => {
    const supabase = makeSupabase()
    supabase.eq.mockResolvedValue({ data: [], error: null })
    const result = await findCuratedAnswer(supabase, 'machine-1', makeEmbedding(1))
    expect(result).toBeNull()
  })
})

describe('saveCuratedAnswer', () => {
  it('inserts a curated answer row', async () => {
    const supabase = makeSupabase()
    supabase.insert = jest.fn().mockResolvedValue({ error: null })

    await expect(
      saveCuratedAnswer(supabase, 'machine-1', 'Pergunta?', makeEmbedding(0.5), 'Resposta.', 'user-1')
    ).resolves.toBeUndefined()

    expect(supabase.from).toHaveBeenCalledWith('rag_curated_answers')
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ machine_id: 'machine-1', question: 'Pergunta?', answer: 'Resposta.' })
    )
  })

  it('throws on insert error', async () => {
    const supabase = makeSupabase()
    supabase.insert = jest.fn().mockResolvedValue({ error: { message: 'DB failure' } })
    await expect(
      saveCuratedAnswer(supabase, 'machine-1', 'Q', makeEmbedding(0.5), 'A', 'user-1')
    ).rejects.toThrow('Failed to save curated answer: DB failure')
  })
})

describe('deleteCuratedAnswer', () => {
  it('deletes by id', async () => {
    const supabase = makeSupabase()
    supabase.eq = jest.fn().mockResolvedValue({ error: null })

    await expect(deleteCuratedAnswer(supabase, 'answer-id')).resolves.toBeUndefined()
    expect(supabase.from).toHaveBeenCalledWith('rag_curated_answers')
    expect(supabase.delete).toHaveBeenCalled()
  })

  it('throws on delete error', async () => {
    const supabase = makeSupabase()
    supabase.eq = jest.fn().mockResolvedValue({ error: { message: 'DB failure' } })
    await expect(deleteCuratedAnswer(supabase, 'bad-id')).rejects.toThrow('Failed to delete curated answer')
  })
})
