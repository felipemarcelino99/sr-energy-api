import PDFDocument from 'pdfkit'
import { parseReportHtml, renderReportHtml } from '@/utils/richTextPdf'

describe('parseReportHtml', () => {
  it('separa parágrafos em blocos distintos', () => {
    const blocks = parseReportHtml('<p>Primeiro</p><p>Segundo</p>')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'Primeiro', bold: false, italic: false, underline: false }],
    })
  })

  it('preserva negrito, itálico e sublinhado', () => {
    const blocks = parseReportHtml('<p>normal <strong>negrito</strong> <em>itálico</em> <u>sublinhado</u></p>')
    const runs = blocks[0].type === 'paragraph' ? blocks[0].runs : []
    expect(runs.find((r) => r.text === 'negrito')).toMatchObject({ bold: true })
    expect(runs.find((r) => r.text === 'itálico')).toMatchObject({ italic: true })
    expect(runs.find((r) => r.text === 'sublinhado')).toMatchObject({ underline: true })
  })

  it('reconhece headings h1-h3 e listas ordenadas/não-ordenadas', () => {
    const blocks = parseReportHtml('<h2>Título</h2><ul><li>A</li></ul><ol><li>B</li></ol>')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 })
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false })
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: true })
  })

  it('retorna lista vazia pra HTML vazio', () => {
    expect(parseReportHtml('')).toEqual([])
  })
})

describe('renderReportHtml', () => {
  it('renderiza no doc pdfkit sem lançar erro, pra HTML rico', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    doc.on('data', () => {})
    expect(() => {
      renderReportHtml(
        doc,
        '<h1>Título</h1><p>Texto <strong>negrito</strong> e <em>itálico</em>.</p><ul><li>Item 1</li><li>Item 2</li></ul>',
      )
      doc.end()
    }).not.toThrow()
  })
})
