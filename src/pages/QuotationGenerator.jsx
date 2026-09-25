import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { generateQuotationPDF } from '../lib/quotationPdf'
import './QuotationGenerator.css'

const DEFAULT_PAYMENT_TERMS = [
  '50% upon contract signing. Work begins only after this payment is received.',
  '50% upon deployment and handover.',
  'All prices are project-based and exclusive of any third-party costs (hosting, API subscriptions, licences).',
].join('\n')

const DEFAULT_NOTES = 'This quotation is valid for 14 days from the date of issue. Prices are subject to change after the validity period. For questions, contact us at flex@sdfmgroup.com.'

const DEFAULT_ITEMS = [
  { description: 'AI Gap Assessment', quantity: 1, unit_price: 0 },
  { description: 'Solution Design & Development', quantity: 1, unit_price: '' },
  { description: 'Deployment & Configuration', quantity: 1, unit_price: '' },
  { description: 'Staff Training & Handover', quantity: 1, unit_price: '' },
]

const STATUS_OPTIONS = ['draft', 'sent', 'accepted', 'rejected', 'expired']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function addDaysISO(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    lead_id: '',
    issue_date: todayISO(),
    valid_until: addDaysISO(14),
    currency: 'KES',
    tax_rate: 0,
    payment_terms: DEFAULT_PAYMENT_TERMS,
    notes: DEFAULT_NOTES,
    items: DEFAULT_ITEMS.map(i => ({ ...i })),
  }
}

export default function QuotationGenerator() {
  const { profile } = useAuth()
  const [quotations, setQuotations] = useState([])
  const [leadsList, setLeadsList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [newQuote, setNewQuote] = useState(emptyForm)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchQuotations(); fetchLeads() }, [])
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchQuotations() {
    const { data } = await supabase
      .from('quotations')
      .select('*, leads(company_name, full_name, email, phone)')
      .order('created_at', { ascending: false })
    if (data) setQuotations(data)
    setLoading(false)
  }

  async function fetchLeads() {
    const { data } = await supabase.from('leads').select('id, company_name, full_name, email, phone').order('company_name')
    if (data) setLeadsList(data)
  }

  const filtered = quotations.filter(q => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return q.quote_number?.toLowerCase().includes(s) || q.leads?.company_name?.toLowerCase().includes(s)
  })

  const selectedLead = leadsList.find(l => l.id === newQuote.lead_id)
  const subtotal = newQuote.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
  const taxAmount = subtotal * (Number(newQuote.tax_rate) || 0) / 100
  const total = subtotal + taxAmount

  function updateItem(idx, field, value) {
    setNewQuote(prev => ({ ...prev, items: prev.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }))
  }

  function addItem() {
    setNewQuote(prev => ({ ...prev, items: [...prev.items, { description: '', quantity: 1, unit_price: '' }] }))
  }

  function removeItem(idx) {
    setNewQuote(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newQuote.lead_id) { showToast('error', 'Select a lead first'); return }
    const items = newQuote.items.filter(i => i.description.trim())
    if (items.length === 0) { showToast('error', 'Add at least one line item'); return }

    setCreating(true)
    const subtotalVal = items.reduce((sum, i) => sum + Number(i.quantity) * (Number(i.unit_price) || 0), 0)
    const taxAmountVal = subtotalVal * (Number(newQuote.tax_rate) || 0) / 100
    const totalVal = subtotalVal + taxAmountVal

    const { data: quotation, error } = await supabase
      .from('quotations')
      .insert({
        lead_id: newQuote.lead_id,
        issue_date: newQuote.issue_date,
        valid_until: newQuote.valid_until || null,
        currency: newQuote.currency,
        tax_rate: Number(newQuote.tax_rate) || 0,
        subtotal: subtotalVal,
        total: totalVal,
        payment_terms: newQuote.payment_terms,
        notes: newQuote.notes,
        created_by: profile?.id,
      })
      .select('*, leads(company_name, full_name, email, phone)')
      .single()

    if (error || !quotation) {
      showToast('error', error?.message || 'Failed to create quotation')
      setCreating(false)
      return
    }

    const itemsPayload = items.map((it, idx) => ({
      quotation_id: quotation.id,
      description: it.description.trim(),
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      sort_order: idx,
    }))
    const { error: itemsError } = await supabase.from('quotation_items').insert(itemsPayload)

    if (itemsError) {
      showToast('error', 'Quotation saved, but line items failed to save')
      setCreating(false)
      return
    }

    try {
      await generateQuotationPDF({ quotation, items: itemsPayload, lead: quotation.leads })
    } catch (err) {
      console.error('[PDF] generation failed:', err)
      showToast('error', 'Quotation saved, but the PDF could not be generated')
    }

    setQuotations(prev => [quotation, ...prev])
    setCreating(false)
    setShowCreate(false)
    setNewQuote(emptyForm())
    showToast('success', `Quotation ${quotation.quote_number} created`)
  }

  async function handleDownload(quotation) {
    setDownloadingId(quotation.id)
    const { data: items, error } = await supabase
      .from('quotation_items').select('*').eq('quotation_id', quotation.id).order('sort_order')
    if (error) {
      showToast('error', 'Failed to load line items')
      setDownloadingId(null)
      return
    }
    try {
      await generateQuotationPDF({ quotation, items: items || [], lead: quotation.leads })
    } catch (err) {
      console.error('[PDF] generation failed:', err)
      showToast('error', 'Failed to generate PDF')
    }
    setDownloadingId(null)
  }

  async function handleStatusChange(quotation, status) {
    const { error } = await supabase.from('quotations').update({ status }).eq('id', quotation.id)
    if (error) { showToast('error', 'Failed to update status'); return }
    setQuotations(prev => prev.map(q => q.id === quotation.id ? { ...q, status } : q))
  }

  function formatMoney(quotation) {
    return `${quotation.currency} ${Number(quotation.total).toLocaleString('en-US')}`
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Quotations</h1></div>
        <div className="section-card">{[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header quote-header">
        <div>
          <h1 className="page-title">Quotations</h1>
          <p className="page-subtitle">{quotations.length} quotation{quotations.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="quote-header-actions">
          {quotations.length > 0 && (
            <div className="quote-search-wrap">
              <svg className="quote-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <input type="text" className="quote-search" placeholder="Search quotations..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ New Quotation</button>
        </div>
      </div>

      {quotations.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 4h16l6 6v26H10z" /><path d="M15 16h10M15 22h10M15 28h6" /></svg>
            </div>
            <div className="empty-state-title">No quotations yet</div>
            <p className="empty-state-desc">Create a quotation for a lead to generate a branded PDF.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="quote-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quote No</th>
                  <th>Client</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Issue Date</th>
                  <th>Valid Until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => (
                  <tr key={q.id}>
                    <td className="quote-number">{q.quote_number}</td>
                    <td>{q.leads?.company_name || '—'}</td>
                    <td className="quote-total">{formatMoney(q)}</td>
                    <td>
                      <select
                        className={`quote-status-select status-badge status-${q.status}`}
                        value={q.status}
                        onChange={e => handleStatusChange(q, e.target.value)}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                      </select>
                    </td>
                    <td>{formatDate(q.issue_date)}</td>
                    <td>{formatDate(q.valid_until)}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(q)} disabled={downloadingId === q.id}>
                        {downloadingId === q.id ? '...' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <p className="empty-state-desc">No quotations match your search</p>
              </div>
            )}
          </div>

          <div className="quote-mobile-list">
            {filtered.map(q => (
              <div key={q.id} className="quote-mobile-card">
                <div className="quote-mobile-card-top">
                  <div>
                    <div className="quote-mobile-number">{q.quote_number}</div>
                    <div className="quote-mobile-client">{q.leads?.company_name || '—'}</div>
                  </div>
                  <span className={`status-badge status-${q.status}`}>{q.status}</span>
                </div>
                <div className="quote-mobile-card-bottom">
                  <span className="quote-mobile-meta"><span className="quote-mobile-label">Total</span>{formatMoney(q)}</span>
                  <span className="quote-mobile-meta"><span className="quote-mobile-label">Valid Until</span>{formatDate(q.valid_until)}</span>
                </div>
                <button className="btn btn-secondary btn-sm quote-mobile-download" onClick={() => handleDownload(q)} disabled={downloadingId === q.id}>
                  {downloadingId === q.id ? 'Preparing...' : 'Download PDF'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create Quotation Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">New Quotation</h3>
            <p className="modal-subtitle">Generates an SDFM-branded PDF for the selected lead.</p>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Lead</label>
                <select className="form-input" required value={newQuote.lead_id} onChange={e => setNewQuote({ ...newQuote, lead_id: e.target.value })}>
                  <option value="">Select a lead...</option>
                  {leadsList.map(l => <option key={l.id} value={l.id}>{l.company_name} — {l.full_name}</option>)}
                </select>
              </div>

              {selectedLead && (
                <div className="quote-lead-preview">
                  <span>{selectedLead.email}</span>
                  <span>{selectedLead.phone}</span>
                </div>
              )}

              <div className="composer-two-col">
                <div className="form-group">
                  <label className="form-label">Issue Date</label>
                  <input type="date" className="form-input" value={newQuote.issue_date} onChange={e => setNewQuote({ ...newQuote, issue_date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Valid Until</label>
                  <input type="date" className="form-input" value={newQuote.valid_until} onChange={e => setNewQuote({ ...newQuote, valid_until: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-input" value={newQuote.currency} onChange={e => setNewQuote({ ...newQuote, currency: e.target.value })}>
                    <option value="KES">KES</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Tax Rate (%)</label>
                  <input type="number" min="0" max="100" step="0.5" className="form-input" value={newQuote.tax_rate} onChange={e => setNewQuote({ ...newQuote, tax_rate: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Scope & Pricing</label>
                <div className="quote-items">
                  <div className="quote-items-head">
                    <span>Description</span>
                    <span>Qty</span>
                    <span>Unit Price</span>
                    <span>Amount</span>
                    <span></span>
                  </div>
                  {newQuote.items.map((item, idx) => (
                    <div className="quote-item-row" key={idx}>
                      <input className="form-input" placeholder="Description" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                      <input className="form-input" type="number" min="0" step="1" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                      <input className="form-input" type="number" min="0" step="0.01" placeholder="0" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} />
                      <span className="quote-item-amount">{((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toLocaleString('en-US')}</span>
                      <button type="button" className="quote-item-remove" onClick={() => removeItem(idx)} aria-label="Remove item">×</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-secondary btn-sm quote-add-item" onClick={addItem}>+ Add Item</button>
              </div>

              <div className="quote-totals">
                <div><span>Subtotal</span><span>{subtotal.toLocaleString('en-US')}</span></div>
                <div><span>Tax ({newQuote.tax_rate || 0}%)</span><span>{taxAmount.toLocaleString('en-US')}</span></div>
                <div className="quote-totals-final"><span>Total</span><span>{newQuote.currency} {total.toLocaleString('en-US')}</span></div>
              </div>

              <div className="form-group">
                <label className="form-label">Payment Terms</label>
                <textarea className="form-input" rows={3} value={newQuote.payment_terms} onChange={e => setNewQuote({ ...newQuote, payment_terms: e.target.value })} />
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={newQuote.notes} onChange={e => setNewQuote({ ...newQuote, notes: e.target.value })} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Generating...' : 'Create & Download PDF'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
          )}
          {toast.text}
        </div>
      )}
    </div>
  )
}
