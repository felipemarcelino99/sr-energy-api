jest.mock('@/services/audit-log.service', () => ({ record: jest.fn().mockResolvedValue(undefined) }))

import { generateReportPdf, type ReportPdfData } from '@/services/document-generation.service'

function buildDb() {
  const upload = jest.fn().mockResolvedValue({ error: null, data: { path: 'x' } })
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null })
  const insertChain = {
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { id: 'doc-1', storage_kind: 'internal' }, error: null }),
    }),
  }
  return {
    storage: { from: jest.fn().mockReturnValue({ upload, createSignedUrl }) },
    from: jest.fn().mockReturnValue({ insert: jest.fn().mockReturnValue(insertChain) }),
    _upload: upload,
  }
}

const reportData: ReportPdfData = {
  jobNumber: '26001',
  clientName: 'ACME Ltda',
  description: 'Manutenção preventiva',
  scheduledDate: '2026-08-20',
  city: 'São Paulo',
  state: 'SP',
  reportContent: 'Tudo funcionando normalmente após a manutenção.',
  employeeName: 'João Silva',
  evidences: [{ fileName: 'foto1.jpg', type: 'image' }],
}

describe('document-generation.service', () => {
  it('gera o PDF, sobe no bucket documents e grava como documento internal', async () => {
    const db = buildDb()

    const documentId = await generateReportPdf(db as any, 'job-1', reportData, 'u-1')

    expect(db.storage.from).toHaveBeenCalledWith('documents')
    expect(db._upload).toHaveBeenCalledWith(
      expect.stringMatching(/^job\/job-1\/relatorio-\d+\.pdf$/),
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )
    expect(db.from).toHaveBeenCalledWith('documents')
    expect(documentId).toBe('doc-1')
  })

  it('propaga erro quando o upload falha', async () => {
    const db = buildDb()
    db.storage.from.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: { message: 'storage down' }, data: null }),
      createSignedUrl: jest.fn(),
    })

    await expect(generateReportPdf(db as any, 'job-1', reportData, 'u-1')).rejects.toThrow('storage down')
  })

  it('remove o PDF órfão do storage quando o insert em documents falha', async () => {
    const remove = jest.fn().mockResolvedValue({ error: null, data: null })
    const upload = jest.fn().mockResolvedValue({ error: null, data: { path: 'x' } })
    const db: any = {
      storage: { from: jest.fn().mockReturnValue({ upload, createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null }), remove }) },
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
          }),
        }),
      }),
    }

    await expect(generateReportPdf(db, 'job-1', reportData, 'u-1')).rejects.toThrow('db down')
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^job\/job-1\/relatorio-\d+\.pdf$/)])
  })
})
