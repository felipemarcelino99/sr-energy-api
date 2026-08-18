import { uploadFile, getSignedUrl } from '@/services/storage.service'

function makeSupabaseMock({ uploadError = null, signedUrl = 'https://signed.example/file', signedError = null, publicUrl = 'https://public.example/file' }: {
  uploadError?: any
  signedUrl?: string
  signedError?: any
  publicUrl?: string
} = {}) {
  return {
    storage: {
      from: jest.fn().mockReturnValue({
        upload: jest.fn().mockResolvedValue({ error: uploadError }),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: signedError ? null : { signedUrl },
          error: signedError,
        }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl } }),
      }),
    },
  } as any
}

describe('uploadFile', () => {
  it('CRITICAL/HIGH-06: usa URL assinada com TTL curto para bucket sensível (contract-files)', async () => {
    const supabase = makeSupabaseMock({ signedUrl: 'https://signed.example/contract.pdf' })
    const url = await uploadFile(supabase, 'contract-files', 'c-1.pdf', Buffer.from('x'), 'application/pdf')
    expect(url).toBe('https://signed.example/contract.pdf')
    expect(supabase.storage.from).toHaveBeenCalledWith('contract-files')
  })

  it('usa URL assinada para bag-certificates', async () => {
    const supabase = makeSupabaseMock({ signedUrl: 'https://signed.example/cert.pdf' })
    const url = await uploadFile(supabase, 'bag-certificates', 'b-1/c-1.pdf', Buffer.from('x'), 'application/pdf')
    expect(url).toBe('https://signed.example/cert.pdf')
  })

  it('usa URL assinada para evidences', async () => {
    const supabase = makeSupabaseMock({ signedUrl: 'https://signed.example/ev.jpg' })
    const url = await uploadFile(supabase, 'evidences', 'r-1/ev.jpg', Buffer.from('x'), 'image/jpeg')
    expect(url).toBe('https://signed.example/ev.jpg')
  })

  it('usa URL pública para bucket não sensível (machine-manuals)', async () => {
    const supabase = makeSupabaseMock({ publicUrl: 'https://public.example/manual.pdf' })
    const url = await uploadFile(supabase, 'machine-manuals', 'm-1.pdf', Buffer.from('x'), 'application/pdf')
    expect(url).toBe('https://public.example/manual.pdf')
  })

  it('lança erro quando upload falha', async () => {
    const supabase = makeSupabaseMock({ uploadError: { message: 'boom' } })
    await expect(
      uploadFile(supabase, 'evidences', 'r-1/ev.jpg', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow('Storage upload failed: boom')
  })
})

describe('getSignedUrl', () => {
  it('retorna a URL assinada', async () => {
    const supabase = makeSupabaseMock({ signedUrl: 'https://signed.example/x' })
    const url = await getSignedUrl(supabase, 'contract-files', 'c-1.pdf')
    expect(url).toBe('https://signed.example/x')
  })

  it('lança erro quando a geração da URL assinada falha', async () => {
    const supabase = makeSupabaseMock({ signedError: { message: 'nope' } })
    await expect(getSignedUrl(supabase, 'contract-files', 'c-1.pdf')).rejects.toThrow('Storage signed URL failed: nope')
  })
})
