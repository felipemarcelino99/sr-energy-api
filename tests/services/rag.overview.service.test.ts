import { getOrGenerateOverview } from '@/services/rag.overview.service'
import Groq from 'groq-sdk'

jest.mock('groq-sdk')

const makeSupabase = (machineRow: any, overviewRow: any, chunksData: any): any => {
  const fromMock = jest.fn().mockImplementation((table: string) => {
    if (table === 'machines') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: machineRow, error: machineRow ? null : { message: 'Not found' } }),
      }
    }
    if (table === 'machine_overviews') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: overviewRow, error: null }),
        upsert: jest.fn().mockResolvedValue({ error: null }),
      }
    }
    if (table === 'machine_chunks') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: chunksData, error: null }),
      }
    }
    return {}
  })
  return { from: fromMock }
}

describe('getOrGenerateOverview', () => {
  it('returns cached overview when pdf_hash matches', async () => {
    const supabase = makeSupabase(
      { pdf_hash: 'abc123', name: 'Máquina A' },
      { content: 'Overview cacheado', pdf_hash: 'abc123' },
      []
    )
    const result = await getOrGenerateOverview(supabase, 'machine-1')
    expect(result).toBe('Overview cacheado')
  })

  it('generates and caches overview when hash differs', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'Overview gerado' } }],
    })
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({ chat: { completions: { create: mockCreate } } }))

    const supabase = makeSupabase(
      { pdf_hash: 'newHash', name: 'Máquina A' },
      { content: 'Old overview', pdf_hash: 'oldHash' },
      [{ content: 'chunk 1' }, { content: 'chunk 2' }]
    )

    const result = await getOrGenerateOverview(supabase, 'machine-1')
    expect(result).toBe('Overview gerado')
    expect(mockCreate).toHaveBeenCalled()
  })

  it('throws when machine has no pdf_hash', async () => {
    const supabase = makeSupabase({ pdf_hash: null, name: 'Máquina A' }, null, [])
    await expect(getOrGenerateOverview(supabase, 'machine-1')).rejects.toThrow(
      'Manual não indexado para esta máquina'
    )
  })
})
