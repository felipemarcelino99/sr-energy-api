import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadFile } from '@/services/storage.service'
import { attachDocument } from '@/services/documents.service'
import { renderReportHtml } from '@/utils/richTextPdf'

// Item 8 (spike) — decisão: geração via `pdfkit` (layout programático, puro
// Node), não HTML+CSS→PDF via headless Chromium (Puppeteer) nem merge de
// `.docx` real convertido por LibreOffice/soffice.
//
// Motivo: a API roda num container pequeno (Fastify + Supabase, sem outra
// infra de browser/LibreOffice hoje); Puppeteer exige bundlar Chromium
// (~300MB, cold start instável em container pequeno) e o merge de `.docx`
// exige um binário externo (LibreOffice headless) só para a conversão final
// para PDF — nenhuma das duas dependências existe hoje na infra do projeto.
// `pdfkit` é puro-JS, determinístico e mais barato de operar; o preço é
// layout menos "WYSIWYG" que um template HTML/Word (harder de bater
// pixel-a-pixel com o padrão visual do portal) — aceitável para a primeira
// fatia da feature; se o time de produto exigir fidelidade visual maior no
// futuro, revisitar com Puppeteer.
//
// Atualização: o corpo do relatório (`data.reportContent`, HTML do
// RichTextEditor/TipTap) não é mais escrito cru via `doc.text()` — isso
// perdia toda formatação (negrito/itálico/sublinhado/headings/listas viravam
// texto plano). `renderReportHtml` (src/utils/richTextPdf.ts) faz o parse do
// subconjunto restrito de HTML que o TipTap gera e desenha cada trecho com a
// fonte/estilo certos no pdfkit. Ainda não é HTML+CSS→PDF genérico (não author
// arbitrário, só o que o editor produz), mas cobre o caso real de uso.

export interface ReportPdfData {
  jobNumber: string
  clientName: string
  description: string
  scheduledDate: string
  city: string
  state: string
  reportContent: string
  employeeName: string
  evidences: Array<{ fileName: string; type: string }>
}

function buildPdfBuffer(data: ReportPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(18).text('Relatório Técnico', { align: 'center' })
    doc.moveDown()
    doc.fontSize(11)
    doc.text(`OS: ${data.jobNumber}`)
    doc.text(`Cliente: ${data.clientName}`)
    doc.text(`Data: ${data.scheduledDate}`)
    doc.text(`Local: ${data.city}/${data.state}`)
    doc.text(`Responsável: ${data.employeeName}`)
    doc.moveDown()

    doc.fontSize(13).font('Helvetica-Bold').text('Escopo')
    doc.fontSize(11).font('Helvetica').text(data.description)
    doc.moveDown()

    doc.fontSize(13).font('Helvetica-Bold').text('Relatório')
    doc.font('Helvetica')
    renderReportHtml(doc, data.reportContent, 11)
    doc.moveDown()

    if (data.evidences.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').text('Evidências anexadas')
      doc.fontSize(11).font('Helvetica')
      for (const ev of data.evidences) {
        doc.text(`• ${ev.fileName} (${ev.type})`)
      }
    }

    doc.end()
  })
}

// Item 9: gera o PDF e grava direto em `documents` como `internal` (reaproveita
// o módulo do item 6 — bucket/signed URL/audit-log já saem de graça).
export async function generateReportPdf(
  db: SupabaseClient,
  jobId: string,
  reportData: ReportPdfData,
  actorId: string,
): Promise<string> {
  const buffer = await buildPdfBuffer(reportData)
  const path = `job/${jobId}/relatorio-${Date.now()}.pdf`

  await uploadFile(db, 'documents', path, buffer, 'application/pdf')

  try {
    const doc = await attachDocument(db, {
      entityType: 'job',
      entityId: jobId,
      bucket: 'documents',
      path,
      label: `Relatório técnico OS ${reportData.jobNumber}`,
      documentType: 'RT',
      actorId,
    })
    return doc.id
  } catch (err) {
    // O PDF já subiu no storage antes do insert em `documents` (storage não
    // participa de transação Postgres) — mesma compensação de POST /documents
    // em routes/documents.ts: se o insert falhar, remove o arquivo órfão.
    try {
      await db.storage.from('documents').remove([path])
    } catch {
      // best-effort — a falha original já será propagada abaixo
    }
    throw err
  }
}
