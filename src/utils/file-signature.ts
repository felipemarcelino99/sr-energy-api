// HIGH-05 (sub-plano 01): checagem de magic bytes compartilhada — usada por
// contracts.ts, bags.ts e reports.ts para não confiar no Content-Type informado
// pelo cliente (facilmente forjável) na hora de decidir o mime real do arquivo.

export const ALLOWED_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
]

export function detectMimeFromBuffer(buf: Buffer): string | null {
  for (const sig of ALLOWED_SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime
  }
  return null
}
