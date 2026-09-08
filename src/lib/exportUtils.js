// Export utilities — CSV and PDF generation for CAC Pipeline
import jsPDF from 'jspdf'
import 'jspdf-autotable'

// ── CSV Export ──

function escapeCSV(val) {
  if (val == null) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function exportCSV(headers, rows, filename) {
  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
  ].join('\n')

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// ── PDF Export ──

function addCACHeader(doc) {
  // Red bar
  doc.setFillColor(236, 48, 19)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F')

  // Logo text
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('CIPHER AI', 14, 14)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('CONSULTANTS', 14, 20)

  // Date
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.setFontSize(9)
  doc.text(dateStr, doc.internal.pageSize.getWidth() - 14, 16, { align: 'right' })

  doc.setTextColor(32, 30, 29) // Reset to charcoal
}

function addFooter(doc) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(
      `Cipher AI Consultants · Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    )
  }
}

export function exportLeadsPDF(leads, filename) {
  const doc = new jsPDF('landscape')
  addCACHeader(doc)

  // Title
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(32, 30, 29)
  doc.text('All Leads Report', 14, 40)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(`${leads.length} lead${leads.length !== 1 ? 's' : ''} · Generated ${new Date().toLocaleString('en-GB')}`, 14, 47)

  // Table
  const headers = [['Name', 'Company', 'Email', 'Phone', 'Class', 'Score', 'Stage', 'Source', 'Date']]
  const rows = leads.map(l => [
    l.full_name || '',
    l.company_name || '',
    l.email || '',
    l.phone || '',
    l.is_disqualified ? 'Cold' : (l.classification || '').charAt(0).toUpperCase() + (l.classification || '').slice(1),
    `${l.total_score}/21`,
    l.is_lost ? 'Lost' : (l.current_stage || ''),
    l.source || 'Website',
    l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB') : '',
  ])

  doc.autoTable({
    head: headers,
    body: rows,
    startY: 53,
    styles: {
      fontSize: 8,
      cellPadding: 3,
      font: 'helvetica',
      textColor: [32, 30, 29],
    },
    headStyles: {
      fillColor: [32, 30, 29],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: [243, 242, 242],
    },
    columnStyles: {
      4: { cellWidth: 18 }, // Class
      5: { cellWidth: 18 }, // Score
    },
    margin: { top: 32, left: 14, right: 14 },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) addCACHeader(doc)
    },
  })

  addFooter(doc)
  doc.save(`${filename}.pdf`)
}

export function exportDashboardPDF(metrics, filename) {
  const doc = new jsPDF('portrait')
  addCACHeader(doc)

  let y = 40

  // Title
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(32, 30, 29)
  doc.text('Pipeline Summary Report', 14, y)
  y += 7

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, 14, y)
  y += 14

  // ── Lead Metrics section ──
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(236, 48, 19)
  doc.text('Lead Metrics', 14, y)
  y += 2

  doc.autoTable({
    startY: y,
    body: [
      ['Total Leads', String(metrics.totalLeads)],
      ['Qualified (Hot + Warm)', String(metrics.qualifiedCount)],
      ['Disqualified (Cold)', String(metrics.coldCount)],
      ['Qualification Rate', `${metrics.qualificationRate}%`],
      ['Hot Leads', String(metrics.hotCount)],
      ['Warm Leads', String(metrics.warmCount)],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 4, font: 'helvetica' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70, textColor: [32, 30, 29] },
      1: { halign: 'right', textColor: [80, 80, 80] },
    },
    margin: { left: 14, right: 14 },
  })

  y = doc.lastAutoTable.finalY + 12

  // ── Pipeline Metrics section ──
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(236, 48, 19)
  doc.text('Pipeline Metrics', 14, y)
  y += 2

  doc.autoTable({
    startY: y,
    body: [
      ['In Pipeline', String(metrics.inPipeline)],
      ['Converted', String(metrics.convertedCount)],
      ['Conversion Rate', `${metrics.conversionRate}%`],
      ['Pipeline Value', metrics.pipelineValueFormatted],
      ['Lost Leads', String(metrics.lostCount)],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 4, font: 'helvetica' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70, textColor: [32, 30, 29] },
      1: { halign: 'right', textColor: [80, 80, 80] },
    },
    margin: { left: 14, right: 14 },
  })

  y = doc.lastAutoTable.finalY + 12

  // ── Leads by Stage ──
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(236, 48, 19)
  doc.text('Leads by Stage', 14, y)
  y += 2

  doc.autoTable({
    startY: y,
    head: [['Stage', 'Count']],
    body: metrics.stageCounts.map(([stage, count]) => [stage, String(count)]),
    styles: { fontSize: 9, cellPadding: 4, font: 'helvetica' },
    headStyles: {
      fillColor: [32, 30, 29],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      1: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  })

  y = doc.lastAutoTable.finalY + 12

  // ── Lead Sources ──
  if (metrics.sources && metrics.sources.length > 0) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(236, 48, 19)
    doc.text('Lead Sources', 14, y)
    y += 2

    doc.autoTable({
      startY: y,
      head: [['Source', 'Count']],
      body: metrics.sources.map(([src, count]) => [src, String(count)]),
      styles: { fontSize: 9, cellPadding: 4, font: 'helvetica' },
      headStyles: {
        fillColor: [32, 30, 29],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        1: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    })
  }

  addFooter(doc)
  doc.save(`${filename}.pdf`)
}
