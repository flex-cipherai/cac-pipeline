// Branded PDF generation for the Quotation Generator, matching the
// "SDFM Quotation Template" reference design (logo header, red rule,
// PREPARED FOR / SCOPE & PRICING / PAYMENT TERMS / NOTES sections).
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const RED = [236, 48, 19]
const CHARCOAL = [32, 30, 29]
const GRAY = [140, 140, 140]
const LINE_GRAY = [225, 224, 224]

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function money(n) {
  const num = Number(n) || 0
  return num === 0 ? 'Free' : num.toLocaleString('en-US')
}

function sanitizeFilename(str) {
  return String(str || 'Client')
    .replace(/[/\\:*?"<>|]/g, '-')
    .trim()
    .replace(/\s+/g, '_')
}

// Draws "label value" right-aligned at x, ending at y, with the value in
// front (closer to x) and the label immediately to its left.
function rightAlignedLabelValue(doc, label, value, x, y, { valueBold = true } = {}) {
  const text = String(value ?? '—')
  doc.setFont('helvetica', valueBold ? 'bold' : 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...CHARCOAL)
  doc.text(text, x, y, { align: 'right' })
  const valueWidth = doc.getTextWidth(text)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  doc.text(label, x - valueWidth - 1, y, { align: 'right' })
}

// quotation: { quote_number, status, issue_date, valid_until, currency, tax_rate, payment_terms, notes }
// items: [{ description, quantity, unit_price }]
// lead: { company_name, full_name, email, phone }
export async function generateQuotationPDF({ quotation, items, lead }) {
  const doc = new jsPDF('portrait')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 14

  // ── Header: logo + SDFM contact details ──
  try {
    const logo = await loadImage('/sdfm-logo.png')
    const logoW = 42
    const logoH = logoW * (logo.naturalHeight / logo.naturalWidth)
    doc.addImage(logo, 'PNG', marginX, 10, logoW, logoH)
  } catch {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...RED)
    doc.text('SDFM GROUP', marginX, 18)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CHARCOAL)
    doc.text('LIMITED', marginX, 23)
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...CHARCOAL)
  doc.text('flex@sdfmgroup.com  |  +254 757 230 579', pageWidth - marginX, 14, { align: 'right' })
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...RED)
  doc.text('sdfmgroup.com', pageWidth - marginX, 20, { align: 'right' })

  doc.setDrawColor(...RED); doc.setLineWidth(0.8)
  doc.line(marginX, 30, pageWidth - marginX, 30)

  // ── Title + meta ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...CHARCOAL)
  doc.text('QUOTATION', marginX, 48)

  rightAlignedLabelValue(doc, 'Quote No: ', quotation.quote_number, pageWidth - marginX, 40)
  rightAlignedLabelValue(doc, 'Date: ', formatDate(quotation.issue_date), pageWidth - marginX, 45, { valueBold: false })
  rightAlignedLabelValue(doc, 'Valid Until: ', formatDate(quotation.valid_until), pageWidth - marginX, 50, { valueBold: false })
  rightAlignedLabelValue(doc, 'Currency: ', quotation.currency, pageWidth - marginX, 55)

  // ── Prepared For ──
  let y = 68
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...RED)
  doc.text('PREPARED FOR', marginX, y)
  y += 7

  const preparedRows = [
    ['Client', lead?.company_name],
    ['Contact Person', lead?.full_name],
    ['Email', lead?.email],
    ['Phone', lead?.phone],
  ]
  preparedRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...CHARCOAL)
    doc.text(label, marginX, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value || '—', marginX + 42, y)
    doc.setDrawColor(...LINE_GRAY); doc.setLineWidth(0.3)
    doc.line(marginX, y + 2.5, pageWidth - marginX, y + 2.5)
    y += 7
  })

  // ── Scope & Pricing ──
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...RED)
  doc.text('SCOPE & PRICING', marginX, y)
  y += 3

  const body = items.map((item, idx) => [
    String(idx + 1),
    item.description,
    String(item.quantity),
    money(item.unit_price),
    money(Number(item.quantity) * Number(item.unit_price)),
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit Price', 'Amount']],
    body,
    styles: { fontSize: 9, cellPadding: 3.5, font: 'helvetica', textColor: CHARCOAL },
    headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [243, 242, 242] },
    columnStyles: {
      0: { cellWidth: 10 },
      2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  })

  y = doc.lastAutoTable.finalY + 6

  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0)
  const taxAmount = subtotal * (Number(quotation.tax_rate) / 100)
  const total = subtotal + taxAmount

  autoTable(doc, {
    startY: y,
    body: [
      ['Subtotal', subtotal.toLocaleString('en-US')],
      [`Tax (${quotation.tax_rate}%)`, taxAmount.toLocaleString('en-US')],
      ['TOTAL', total.toLocaleString('en-US')],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3, font: 'helvetica' },
    columnStyles: {
      0: { halign: 'right', cellWidth: 30, textColor: CHARCOAL },
      1: { halign: 'right', cellWidth: 30, textColor: CHARCOAL },
    },
    margin: { left: pageWidth - marginX - 60, right: marginX },
    didParseCell: (data) => {
      if (data.row.index === 2) {
        data.cell.styles.fillColor = RED
        data.cell.styles.textColor = [255, 255, 255]
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  y = doc.lastAutoTable.finalY + 10

  // ── Payment Terms ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...RED)
  doc.text('PAYMENT TERMS', marginX, y)
  y += 6

  const terms = (quotation.payment_terms || '').split('\n').map(t => t.trim()).filter(Boolean)
  terms.forEach((term, idx) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...CHARCOAL)
    const lines = doc.splitTextToSize(`${idx + 1}. ${term}`, pageWidth - marginX * 2)
    doc.text(lines, marginX, y)
    y += lines.length * 4.5
  })

  // ── Notes ──
  y += 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...RED)
  doc.text('NOTES', marginX, y)
  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...CHARCOAL)
  const noteLines = doc.splitTextToSize(quotation.notes || '', pageWidth - marginX * 2)
  doc.text(noteLines, marginX, y)

  // ── Footer ──
  doc.setDrawColor(...RED); doc.setLineWidth(0.5)
  doc.line(marginX, pageHeight - 16, pageWidth - marginX, pageHeight - 16)
  const line1 = 'SDFM Group Limited'
  const line2 = '  Transforming Kenyan Businesses'
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  const w1 = doc.getTextWidth(line1)
  doc.setFont('helvetica', 'italic')
  const w2 = doc.getTextWidth(line2)
  const startX = pageWidth / 2 - (w1 + w2) / 2
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...CHARCOAL)
  doc.text(line1, startX, pageHeight - 10)
  doc.setFont('helvetica', 'italic'); doc.setTextColor(...RED)
  doc.text(line2, startX + w1, pageHeight - 10)

  const clientName = sanitizeFilename(lead?.company_name)
  doc.save(`${clientName}_Quotation_${quotation.quote_number}.pdf`)
}
