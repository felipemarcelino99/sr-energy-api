import { detectMimeFromBuffer } from '@/utils/file-signature'

describe('detectMimeFromBuffer', () => {
  it('detecta PDF pelos magic bytes', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    expect(detectMimeFromBuffer(buf)).toBe('application/pdf')
  })

  it('detecta JPEG pelos magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    expect(detectMimeFromBuffer(buf)).toBe('image/jpeg')
  })

  it('detecta PNG pelos magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    expect(detectMimeFromBuffer(buf)).toBe('image/png')
  })

  it('retorna null para conteúdo desconhecido/forjado', () => {
    const buf = Buffer.from('não é um arquivo real', 'utf-8')
    expect(detectMimeFromBuffer(buf)).toBeNull()
  })

  it('retorna null para buffer vazio', () => {
    expect(detectMimeFromBuffer(Buffer.alloc(0))).toBeNull()
  })
})
