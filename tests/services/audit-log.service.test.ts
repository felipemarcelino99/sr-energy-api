import { record, history } from '@/services/audit-log.service'

function buildDb(overrides: Partial<Record<'insert' | 'select' | 'eq' | 'order', jest.Mock>> = {}) {
  const chain: any = {
    insert: overrides.insert ?? jest.fn().mockResolvedValue({ data: null, error: null }),
    select: overrides.select ?? jest.fn().mockReturnThis(),
    eq: overrides.eq ?? jest.fn().mockReturnThis(),
    order: overrides.order ?? jest.fn().mockResolvedValue({ data: [], error: null }),
  }
  return { from: jest.fn().mockReturnValue(chain), ...chain }
}

describe('audit-log.service', () => {
  describe('record', () => {
    it('grava evento na tabela audit_log com os campos mapeados', async () => {
      const insert = jest.fn().mockResolvedValue({ data: null, error: null })
      const db = buildDb({ insert })

      await record(db as any, {
        entityType: 'contract',
        entityId: 'c-1',
        actorId: 'u-1',
        action: 'contract.accepted',
        metadata: { jobId: 'j-1' },
      })

      expect(db.from).toHaveBeenCalledWith('audit_log')
      expect(insert).toHaveBeenCalledWith({
        entity_type: 'contract',
        entity_id: 'c-1',
        actor_id: 'u-1',
        action: 'contract.accepted',
        metadata: { jobId: 'j-1' },
      })
    })

    it('é best-effort — não lança quando o insert falha', async () => {
      const insert = jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
      const db = buildDb({ insert })
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(record(db as any, {
        entityType: 'contract', entityId: 'c-1', actorId: 'u-1', action: 'contract.rejected',
      })).resolves.toBeUndefined()

      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('history', () => {
    it('retorna o histórico ordenado por created_at ascendente', async () => {
      const rows = [{ id: 'a-1', action: 'contract.accepted' }]
      const order = jest.fn().mockResolvedValue({ data: rows, error: null })
      const db = buildDb({ order })

      const result = await history(db as any, 'contract', 'c-1')

      expect(db.from).toHaveBeenCalledWith('audit_log')
      expect(order).toHaveBeenCalledWith('created_at', { ascending: true })
      expect(result).toEqual(rows)
    })

    it('lança erro quando a query falha', async () => {
      const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
      const db = buildDb({ order })

      await expect(history(db as any, 'contract', 'c-1')).rejects.toThrow('db down')
    })
  })
})
