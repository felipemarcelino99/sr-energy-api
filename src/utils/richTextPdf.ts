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

// Bug A2: o TipTap pode envolver o texto de um <li> em <p>...</p> (ex:
// `<li><p>a</p></li>`), e `parseInline` não reconhece a tag `p` — ela apareceria
// literalmente como texto no PDF. Normaliza removendo os wrappers <p>/</p> do
// conteúdo do item antes de passar pra `parseInline`; se houver múltiplos <p>
// dentro do mesmo <li>, junta o conteúdo com quebra de linha entre eles.
function stripListItemParagraphs(html: string): string {
  const pRe = /<p>([\s\S]*?)<\/p>/gi
  const parts: string[] = []
  let found = false
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(html))) {
    found = true
    parts.push(pm[1])
  }
  if (found) return parts.join('\n')
  // Sem wrapper <p> — remove tags <p>/</p> soltas por segurança (malformado) e segue.
  return html.replace(/<\/?p>/gi, '')
}

// Bug A1: relatórios legados podem ser texto puro, sem nenhuma tag de bloco
// reconhecida (h1-3/p/ul/ol). Nesse caso o `blockRe` de `parseReportHtml` não
// bate em nada e o conteúdo inteiro desaparecia do PDF. Trata o texto puro como
// parágrafos: linhas em branco (`\n\n`) separam parágrafos, e dentro de cada
// parágrafo uma quebra de linha simples (`\n`) vira `<br>` (mesmo mecanismo que
// `parseInline` já usa pra quebras de linha), reaproveitando `parseInline` pra
// decodificar entidades HTML residuais (ex: `&amp;`) que o texto legado possa ter.
function parsePlainText(text: string): ReportBlock[] {
  const paragraphs = text.split(/\n\s*\n/)
  const blocks: ReportBlock[] = []
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue
    const withBreaks = trimmed.replace(/\n/g, '<br>')
    blocks.push({ type: 'paragraph', runs: parseInline(withBreaks) })
  }
  return blocks
}

/** Converte o HTML gerado pelo RichTextEditor (TipTap) numa lista de blocos
 * estruturados, preservando negrito/itálico/sublinhado/headings/listas. */
export function parseReportHtml(html: string): ReportBlock[] {
  const hasBlockTag = /<(h[1-3]|p|ul|ol)>/i.test(html)
  if (!hasBlockTag) return parsePlainText(html)

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
      while ((lm = liRe.exec(inner))) items.push(parseInline(stripListItemParagraphs(lm[1])))
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

// Bug (achado na verificação real do A1): um run `<br>` (`text: '\n'`) emitido
// como `doc.text('\n', { continued: true })` no meio de uma cadeia `continued`
// não produz quebra de linha no pdfkit — o texto seguinte cola sem espaço no
// anterior (ex: "cliente.Sem"). E fechar a cadeia com `doc.text('', { continued:
// false })` (string vazia) também não avança a linha corretamente — a altura
// calculada pro trecho vazio é zero e a próxima chamada sobrepõe a anterior.
// pdfkit só quebra linha de forma confiável quando a cadeia `continued` fecha
// com conteúdo real. Por isso agrupamos os runs em "linhas" nos marcadores
// `\n` e renderizamos cada linha como sua própria cadeia `continued`,
// terminando sempre no último run com texto de fato.
function renderRunLine(doc: PDFKit.PDFDocument, lineRuns: TextRun[]): void {
  lineRuns.forEach((r, i) => {
    doc.font(fontFor(r))
    const isLast = i === lineRuns.length - 1
    doc.text(r.text, { continued: !isLast, underline: Boolean(r.underline) })
  })
}

function renderRuns(doc: PDFKit.PDFDocument, runs: TextRun[]): void {
  if (runs.length === 0) return

  const lines: TextRun[][] = [[]]
  for (const r of runs) {
    if (r.text === '\n') {
      lines.push([])
    } else {
      lines[lines.length - 1].push(r)
    }
  }

  for (const lineRuns of lines) {
    if (lineRuns.length === 0) continue
    renderRunLine(doc, lineRuns)
  }
}

// Bug A2: item de lista vazio (ex: `<li></li>` ou `<li><p></p></li>`) chega
// aqui com `runs` vazio. O chamador (lista em `renderReportHtml`) precisa de um
// único ponto que decide se abre uma cadeia `continued` (marcador + texto) ou
// fecha a linha já no marcador — nunca abrir com `continued: true` e fechar
// depois com uma chamada de conteúdo vazio (mesmo bug de altura zero do
// `renderRunLine`/`\n` acima: a linha do marcador some ou sobrepõe a próxima).
function renderListItem(doc: PDFKit.PDFDocument, marker: string, runs: TextRun[]): void {
  doc.font('Helvetica')
  if (runs.length === 0) {
    doc.text(marker, { continued: false })
    return
  }
  doc.text(marker, { continued: true })
  renderRuns(doc, runs)
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
        renderListItem(doc, block.ordered ? `${i + 1}. ` : '•  ', runs)
      })
      doc.moveDown(0.3)
    } else {
      doc.fontSize(bodySize)
      renderRuns(doc, block.runs)
      doc.moveDown(0.3)
    }
  }
}
