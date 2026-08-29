import { attachDocument, linkLegacyDocument, listDocuments, getDocumentUrl } from '@/services/documents.service'

jest.mock('@/services/audit-log.service', () => ({ record: jest.fn().mockResolvedValue(undefined) }))
import { record as recordAuditEvent } from '@/services/audit-log.service'

function buildDb(chainOverrides: Record<string, jest.Mock> = {}, storageOverrides: Record<string, jest.Mock> = {}) {
  const chain: any = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...chainOverrides,
  }
  return {
    from: jest.fn().mockReturnValue(chain),
    storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn(), ...storageOverrides }) },
    ...chain,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('documents.service', () => {
  describe('attachDocument', () => {
    it('insere documento internal e grava audit-log document.attached', async () => {
      const row = { id: 'doc-1', entity_type: 'job', entity_id: 'j-1', storage_kind: 'internal' }
      const db = buildDb({ single: jest.fn().mockResolvedValue({ data: row, error: null }) })

      const result = await attachDocument(db as any, {
        entityType: 'job', entityId: 'j-1', bucket: 'documents', path: 'job/j-1/x.pdf', actorId: 'u-1',
      })

      expect(db.from).toHaveBeenCalledWith('documents')
      expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
        entity_type: 'job', entity_id: 'j-1', storage_kind: 'internal', bucket: 'documents', path: 'job/j-1/x.pdf', created_by: 'u-1',
      }))
      expect(recordAuditEvent).toHaveBeenCalledWith(db, expect.objectContaining({
        entityType: 'job', entityId: 'j-1', actorId: 'u-1', action: 'document.attached',
      }))
      expect(result).toEqual(row)
    })

    it('lança erro quando o insert falha', async () => {
      const db = buildDb({ single: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }) })
      await expect(attachDocument(db as any, {
        entityType: 'job', entityId: 'j-1', bucket: 'documents', path: 'x', actorId: 'u-1',
      })).rejects.toThrow('db down')
    })
  })

  describe('linkLegacyDocument', () => {
    it('insere documento drive_link e grava audit-log document.linked', async () => {
      const row = { id: 'doc-2', entity_type: 'contract', entity_id: 'c-1', storage_kind: 'drive_link' }
      const db = buildDb({ single: jest.fn().mockResolvedValue({ data: row, error: null }) })

      const result = await linkLegacyDocument(db as any, {
        entityType: 'contract', entityId: 'c-1', driveUrl: 'https://drive.google.com/x', note: 'acervo 2023', actorId: 'u-2',
      })

      expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
        entity_type: 'contract', entity_id: 'c-1', storage_kind: 'drive_link',
        drive_url: 'https://drive.google.com/x', note: 'acervo 2023', created_by: 'u-2',
      }))
      expect(recordAuditEvent).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'document.linked' }))
      expect(result).toEqual(row)
    })
  })

  describe('listDocuments', () => {
    it('lista documentos de uma entidade ordenados por created_at desc', async () => {
      const rows = [{ id: 'doc-1' }]
      const db = buildDb({ order: jest.fn().mockResolvedValue({ data: rows, error: null }) })
      const result = await listDocuments(db as any, 'job', 'j-1')
      expect(db.eq).toHaveBeenCalledWith('entity_type', 'job')
      expect(result).toEqual(rows)
    })
  })

  describe('getDocumentUrl', () => {
    it('retorna null quando o documento não existe', async () => {
      const db = buildDb({ single: jest.fn().mockResolvedValue({ data: null, error: null }) })
      const result = await getDocumentUrl(db as any, 'doc-x', 'u-1')
      expect(result).toBeNull()
    })

    it('gera signed URL para documento internal e loga acesso', async () => {
      const row = { id: 'doc-1', entity_type: 'job', entity_id: 'j-1', storage_kind: 'internal', bucket: 'documents', path: 'job/j-1/x.pdf' }
      const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null })
      const db = buildDb(
        { single: jest.fn().mockResolvedValue({ data: row, error: null }) },
        { createSignedUrl },
      )

      const result = await getDocumentUrl(db as any, 'doc-1', 'u-1')

      expect(createSignedUrl).toHaveBeenCalledWith('job/j-1/x.pdf', expect.any(Number))
      expect(result).toBe('https://signed/x')
      expect(recordAuditEvent).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'document.accessed' }))
    })

    it('retorna a URL do Drive direto para documento drive_link e loga acesso', async () => {
      const row = { id: 'doc-2', entity_type: 'contract', entity_id: 'c-1', storage_kind: 'drive_link', drive_url: 'https://drive.google.com/x' }
      const db = buildDb({ single: jest.fn().mockResolvedValue({ data: row, error: null }) })

      const result = await getDocumentUrl(db as any, 'doc-2', 'u-1')

      expect(result).toBe('https://drive.google.com/x')
      expect(recordAuditEvent).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'document.accessed', metadata: expect.objectContaining({ storageKind: 'drive_link' }) }))
    })
  })
})
