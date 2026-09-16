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

  // Bug A1: relatórios legados sem nenhuma tag de bloco reconhecida (h1-3/p/ul/ol)
  // não podem desaparecer do PDF.
  it('trata texto puro (sem tags de bloco) como parágrafo', () => {
    const blocks = parseReportHtml('Relatório legado em texto puro, sem tags.')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'Relatório legado em texto puro, sem tags.', bold: false, italic: false, underline: false }],
    })
  })

  it('divide texto puro em múltiplos parágrafos por linha em branco', () => {
    const blocks = parseReportHtml('Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro.')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ type: 'paragraph', runs: [{ text: 'Primeiro parágrafo.' }] })
    expect(blocks[1]).toMatchObject({ type: 'paragraph', runs: [{ text: 'Segundo parágrafo.' }] })
    expect(blocks[2]).toMatchObject({ type: 'paragraph', runs: [{ text: 'Terceiro.' }] })
  })

  it('preserva quebra de linha simples dentro de um parágrafo de texto puro', () => {
    const blocks = parseReportHtml('Linha 1\nLinha 2')
    expect(blocks).toHaveLength(1)
    const runs = blocks[0].type === 'paragraph' ? blocks[0].runs : []
    expect(runs.map((r) => r.text)).toEqual(['Linha 1', '\n', 'Linha 2'])
  })

  it('decodifica entidades HTML residuais em texto puro', () => {
    const blocks = parseReportHtml('Tensão &amp; corrente dentro do padrão')
    const runs = blocks[0].type === 'paragraph' ? blocks[0].runs : []
    expect(runs[0].text).toBe('Tensão & corrente dentro do padrão')
  })

  // Bug A2: <p> dentro de <li> (TipTap envolve o texto do item nisso) não pode
  // sobrar como tag literal no texto do PDF.
  it('remove <p> interno de <li> e usa o texto puro do item', () => {
    const blocks = parseReportHtml('<ul><li><p>a</p></li></ul>')
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false })
    const items = blocks[0].type === 'list' ? blocks[0].items : []
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual([{ text: 'a', bold: false, italic: false, underline: false }])
    expect(items[0].some((r) => r.text.includes('<p>') || r.text.includes('</p>'))).toBe(false)
  })

  it('não lança erro com item de lista vazio e processa o item seguinte corretamente', () => {
    expect(() => parseReportHtml('<ul><li></li><li><p>b</p></li></ul>')).not.toThrow()
    const blocks = parseReportHtml('<ul><li></li><li><p>b</p></li></ul>')
    const items = blocks[0].type === 'list' ? blocks[0].items : []
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual([])
    expect(items[1]).toEqual([{ text: 'b', bold: false, italic: false, underline: false }])
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

  it('renderiza texto puro (relatório legado sem tags) sem lançar erro', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    doc.on('data', () => {})
    expect(() => {
      renderReportHtml(doc, 'Relatório legado só em texto puro, sem nenhuma tag.')
      doc.end()
    }).not.toThrow()
  })

  // Bug A2: item de lista vazio não pode deixar o marcador (bullet/número) sem
  // fechar a linha — o próximo bloco grudaria nele.
  it('fecha a linha do marcador quando o item de lista está vazio', () => {
    const calls: Array<{ text: string; opts: Record<string, unknown> | undefined }> = []
    const fakeDoc = {
      font: jest.fn().mockReturnThis(),
      fontSize: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      text: jest.fn(function (this: unknown, text: string, opts?: Record<string, unknown>) {
        calls.push({ text, opts })
        return fakeDoc
      }),
    } as unknown as PDFKit.PDFDocument

    renderReportHtml(fakeDoc, '<ul><li></li><li><p>b</p></li></ul>')

    // Marcador do 1º item (bullet) fecha a própria linha numa única chamada —
    // fechar com uma chamada de conteúdo vazio separada (`continued: false`,
    // texto '') deixava a altura da linha zerada no pdfkit real e a próxima
    // linha sobrepunha o marcador (achado na verificação real do A1/A2).
    expect(calls[0]).toMatchObject({ text: '•  ', opts: { continued: false } })
    // 2º item renderiza normalmente na linha seguinte, sem <p> literal.
    expect(calls[1]).toMatchObject({ text: '•  ', opts: { continued: true } })
    expect(calls[2].text).toBe('b')
  })

  // Achado na verificação real (PDFs abertos e inspecionados): um `<br>` (run
  // `\n`) emitido como `doc.text('\n', { continued: true })` no meio de uma
  // cadeia `continued` não quebra linha no pdfkit real — o texto seguinte cola
  // sem espaço no anterior. Precisa fechar a linha e abrir uma nova de verdade.
  it('quebra a linha de verdade em <br> dentro de um parágrafo (pdfkit real)', () => {
    const calls: Array<{ text: string; opts: Record<string, unknown> | undefined }> = []
    const fakeDoc = {
      font: jest.fn().mockReturnThis(),
      fontSize: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      text: jest.fn(function (this: unknown, text: string, opts?: Record<string, unknown>) {
        calls.push({ text, opts })
        return fakeDoc
      }),
    } as unknown as PDFKit.PDFDocument

    renderReportHtml(fakeDoc, '<p>Linha 1<br>Linha 2</p>')

    expect(calls[0]).toMatchObject({ text: 'Linha 1', opts: { continued: false } })
    expect(calls[1]).toMatchObject({ text: 'Linha 2', opts: { continued: false } })
  })

  it('quebra linhas simples dentro de um parágrafo de texto legado (pdfkit real)', () => {
    const calls: Array<{ text: string; opts: Record<string, unknown> | undefined }> = []
    const fakeDoc = {
      font: jest.fn().mockReturnThis(),
      fontSize: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      text: jest.fn(function (this: unknown, text: string, opts?: Record<string, unknown>) {
        calls.push({ text, opts })
        return fakeDoc
      }),
    } as unknown as PDFKit.PDFDocument

    renderReportHtml(fakeDoc, 'Equipamento testado e aprovado pelo cliente.\nSem pendencias.')

    expect(calls[0]).toMatchObject({ text: 'Equipamento testado e aprovado pelo cliente.', opts: { continued: false } })
    expect(calls[1]).toMatchObject({ text: 'Sem pendencias.', opts: { continued: false } })
  })
})
