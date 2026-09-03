// Parser leve pro subconjunto restrito de HTML que o TipTap (RichTextEditor
// do frontend) gera: p, br, h1-h3, strong/b, em/i, u, ul/ol/li. Não é um
// parser de HTML genérico — não lida com HTML arbitrário, só o que o próprio
// editor produz. Evita depender de uma lib de parse de HTML (cheerio/jsdom)
// só pra isso. Espelha src/utils/richTextPdf.ts do frontend (repos separados,
// sem pacote compartilhado hoje).

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type ReportBlock =
  | { type: 'heading'; level: 1 | 2 | 3; runs: TextRun[] }
  | { type: 'paragraph'; runs: TextRun[] }
  | { type: 'list'; ordered: boolean; items: TextRun[][] }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function parseInline(html: string): TextRun[] {
  const runs: TextRun[] = []
  let bold = 0
  let italic = 0
  let underline = 0
  const tagRe = /<(\/?)(strong|b|em|i|u|br)\s*\/?>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index)
    if (text) runs.push({ text: decodeEntities(text), bold: bold > 0, italic: italic > 0, underline: underline > 0 })
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'br') {
      runs.push({ text: '\n', bold: bold > 0, italic: italic > 0, underline: underline > 0 })
    } else if (tag === 'strong' || tag === 'b') {
      bold += closing ? -1 : 1
    } else if (tag === 'em' || tag === 'i') {
      italic += closing ? -1 : 1
    } else if (tag === 'u') {
      underline += closing ? -1 : 1
    }
    last = tagRe.lastIndex
  }
  const rest = html.slice(last)
  if (rest) runs.push({ text: decodeEntities(rest), bold: bold > 0, italic: italic > 0, underline: underline > 0 })
  return runs.filter((r) => r.text.length > 0)
}

/** Converte o HTML gerado pelo RichTextEditor (TipTap) numa lista de blocos
 * estruturados, preservando negrito/itálico/sublinhado/headings/listas. */
export function parseReportHtml(html: string): ReportBlock[] {
  const blocks: ReportBlock[] = []
  const blockRe = /<(h[1-3]|p|ul|ol)>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html))) {
    const tag = m[1].toLowerCase()
    const inner = m[2]
    if (tag === 'ul' || tag === 'ol') {
      const items: TextRun[][] = []
      const liRe = /<li>([\s\S]*?)<\/li>/gi
      let lm: RegExpExecArray | null
      while ((lm = liRe.exec(inner))) items.push(parseInline(lm[1]))
      blocks.push({ type: 'list', ordered: tag === 'ol', items })
    } else if (tag.startsWith('h')) {
      blocks.push({ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3, runs: parseInline(inner) })
    } else {
      blocks.push({ type: 'paragraph', runs: parseInline(inner) })
    }
  }
  return blocks
}

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 16, 2: 14, 3: 12 }

function fontFor(r: TextRun): string {
  if (r.bold && r.italic) return 'Helvetica-BoldOblique'
  if (r.bold) return 'Helvetica-Bold'
  if (r.italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

function renderRuns(doc: PDFKit.PDFDocument, runs: TextRun[]): void {
  runs.forEach((r, i) => {
    doc.font(fontFor(r))
    const isLast = i === runs.length - 1
    doc.text(r.text, { continued: !isLast, underline: Boolean(r.underline) })
  })
}

/** Renderiza o HTML do TipTap no doc pdfkit corrente, preservando
 * negrito/itálico/sublinhado/headings/listas (em vez de `doc.text(html)` cru). */
export function renderReportHtml(doc: PDFKit.PDFDocument, html: string, bodySize = 11): void {
  const blocks = parseReportHtml(html)
  for (const block of blocks) {
    if (block.type === 'heading') {
      doc.fontSize(HEADING_SIZES[block.level])
      renderRuns(doc, block.runs)
      doc.moveDown(0.3)
      doc.fontSize(bodySize)
    } else if (block.type === 'list') {
      doc.fontSize(bodySize)
      block.items.forEach((runs, i) => {
        doc.font('Helvetica').text(block.ordered ? `${i + 1}. ` : '•  ', { continued: true })
        renderRuns(doc, runs)
      })
      doc.moveDown(0.3)
    } else {
      doc.fontSize(bodySize)
      renderRuns(doc, block.runs)
      doc.moveDown(0.3)
    }
  }
}
