// نافذة الفاتورة: معاينة A4 + طباعة / حفظ PDF + إلغاء (المحاسب والمديرين)
// + زرار الفاتورة اللي بيتحط جنب أي دفعة (InvoiceAction): يفتح الفاتورة أو يصدرها
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { dbErr } from '../lib/dbErrors'
import { fmtNum } from '../lib/format'
import useT from '../i18n/useT'
import { buildInvoiceHtml, INVOICE_SELECT } from './invoiceHtml'

// صورة الختم بتتحمل مرة واحدة في الجلسة
let stampCache
export async function loadStamp() {
  if (stampCache !== undefined) return stampCache
  const { data } = await supabase.from('settings').select('value').eq('key', 'invoice_stamp').maybeSingle()
  stampCache = typeof data?.value === 'string' ? data.value : null
  return stampCache
}
export function resetStampCache() { stampCache = undefined }

// المدفوع على الديل لحد الدفعة دي (بالترتيب الزمني) — عشان "المدفوع حتى تاريخه" مايتغيرش مع الدفعات اللي بعدها
async function paidUpTo(dealId, payment) {
  const { data } = await supabase.from('payments').select('id, amount, paid_at, status').eq('deal_id', dealId)
  const at = new Date(payment.paid_at).getTime()
  return (data ?? [])
    .filter(p => p.status === 'active')
    .filter(p => { const t = new Date(p.paid_at).getTime(); return t < at || (t === at && p.id <= payment.id) })
    .reduce((s, p) => s + Number(p.amount || 0), 0)
}

export function printHtml(html) {
  // iframe مخفي للطباعة — أضمن من طباعة الصفحة نفسها
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;inset:auto 0 0 auto;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(f)
  f.srcdoc = html
  f.onload = () => {
    const w = f.contentWindow
    const go = () => { w.focus(); w.print(); setTimeout(() => f.remove(), 60_000) }
    // نستنى الخط يحمل عشان العربي يطلع مظبوط
    if (w.document.fonts?.ready) w.document.fonts.ready.then(() => setTimeout(go, 150))
    else setTimeout(go, 400)
  }
}

export default function InvoiceModal({ invoiceId, onClose, onChanged }) {
  const { t } = useT()
  const { isManager, roleCode } = useAuth()
  const canCancel = isManager || roleCode === 'accountant'
  const [inv, setInv] = useState(null)
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const frame = useRef(null)

  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', invoiceId).single()
    if (error || !data) { setErr(t('invoice.loadFailed')); return }
    const [stamp, paid] = await Promise.all([loadStamp(), paidUpTo(data.deals?.id, data.payments ?? {})])
    setInv(data)
    setHtml(buildInvoiceHtml(data, { stamp, paidToDate: paid }))
  }, [invoiceId, t])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { cancelling ? setCancelling(false) : onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelling, onClose])

  function openTab() {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function doCancel() {
    const r = reason.trim()
    if (!r || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('cancel_invoice', { p_invoice_id: invoiceId, p_reason: r })
    setBusy(false)
    if (error) { setErr(t('invoice.cancelFailed') + ' — ' + dbErr(error.message)); return }
    setCancelling(false); setReason('')
    await load(); onChanged?.()
  }

  const cancelled = inv?.status === 'cancelled'

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal invdlg" role="dialog" aria-modal="true" aria-label={t('invoice.title')}>
        <div className="invdlg-head">
          <div>
            <h2 style={{ margin: 0 }}>{t('invoice.title')}</h2>
            {inv && (
              <p className="sub" style={{ margin: '2px 0 0' }}>
                <span dir="ltr">{inv.invoice_no}</span> · {fmtNum(inv.amount)} {t('common.currency')}
                {cancelled && <> · <b style={{ color: 'var(--danger)' }}>{t('invoice.cancelledBadge')}</b></>}
              </p>
            )}
          </div>
          <div className="invdlg-acts">
            <button className="btn btn-primary" disabled={!html} onClick={() => printHtml(html)}>🖨 {t('invoice.print')}</button>
            <button className="btn btn-ghost" disabled={!html} onClick={openTab}>{t('invoice.openTab')}</button>
            {canCancel && inv && !cancelled && (
              <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => { setCancelling(true); setReason('') }}>
                {t('invoice.cancel')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
        <div className="invdlg-hint">{t('invoice.pdfHint')}</div>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="invdlg-frame">
          {html
            ? <iframe ref={frame} title={inv?.invoice_no ?? 'invoice'} srcDoc={html} />
            : !err && <div className="empty">{t('common.loading')}</div>}
        </div>
      </div>

      {cancelling && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setCancelling(false)}>
          <div className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label={t('invoice.cancelTitle')}>
            <h2>{t('invoice.cancelTitle')}</h2>
            <p className="sub"><span dir="ltr">{inv?.invoice_no}</span><br />{t('invoice.cancelSub')}</p>
            <div className="field">
              <label>{t('payments.voidReason')}</label>
              <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                onKeyDown={e => e.key === 'Enter' && doCancel()} placeholder={t('invoice.cancelPh')} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-danger" disabled={!reason.trim() || busy} onClick={doCancel}>{t('invoice.cancelConfirm')}</button>
              <button className="btn btn-ghost" onClick={() => setCancelling(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// خانة مبلغ الضريبة (بالريال) — المنسقة بتكتب الرقم بإيدها
// مستخدمة في تسجيل الدفعة وإصدار فاتورة لدفعة قديمة
export function VatField({ amount, value, onChange, autoFocus }) {
  const { t } = useT()
  const SAR = t('common.currency')
  const a = Number(amount) || 0
  const v = value === '' || value == null ? null : Number(value)
  return (
    <div className="field">
      <label>{t('invoice.vat')} ({SAR}) <span style={{ color: 'var(--danger)' }}>*</span></label>
      <input type="number" min={0} step="0.01" inputMode="decimal" value={value ?? ''} autoFocus={autoFocus}
        placeholder={t('invoice.vatPh')} onChange={e => onChange(e.target.value)} />
      <small style={{ color: 'var(--ink-soft)', fontSize: 12 }}>
        {t('invoice.vatHint')}
        {a > 0 && v != null && v >= 0 && v < a && <> · {t('invoice.beforeVat')}: <b>{fmtNum(Math.round((a - v) * 100) / 100)} {SAR}</b></>}
      </small>
    </div>
  )
}

// أحدث فاتورة للدفعة: السارية الأول، وإلا آخر واحدة ملغاة
export function pickInvoice(invoices) {
  const list = invoices ?? []
  return list.find(i => i.status === 'issued') ?? [...list].sort((a, b) => b.id - a.id)[0] ?? null
}

// زرار الفاتورة جنب الدفعة
// payment: { id, amount, status, vat_amount, invoices: [{ id, invoice_no, status }] }
export function InvoiceAction({ payment, onChanged, compact = false }) {
  const { t } = useT()
  const [openId, setOpenId] = useState(null)
  const [asking, setAsking] = useState(false)
  const [vat, setVat] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const inv = pickInvoice(payment.invoices)
  const canIssue = payment.status === 'active' && inv?.status !== 'issued'

  async function issue(v) {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('issue_invoice', {
      p_payment_id: payment.id, p_vat: v === '' || v == null ? null : Number(v),
    })
    setBusy(false)
    if (error) { setErr(dbErr(error.message)); return false }
    setAsking(false)
    setOpenId(data)
    onChanged?.()
    return true
  }

  function start() {
    setErr('')
    if (payment.vat_amount != null) issue(null)
    else { setVat(''); setAsking(true) }
  }

  const vatOk = vat !== '' && Number(vat) >= 0 && Number(vat) < Number(payment.amount)

  return (
    <>
      {inv && (inv.status === 'issued' || !canIssue) ? (
        <button type="button" className={compact ? 'mact' : 'btn btn-ghost btn-sm'}
          style={inv.status === 'cancelled' ? { textDecoration: 'line-through', opacity: .7 } : undefined}
          title={inv.status === 'cancelled' ? t('invoice.cancelledBadge') : t('invoice.view')}
          onClick={() => setOpenId(inv.id)}>
          🧾{compact ? '' : <> <span dir="ltr" style={{ fontSize: 11.5 }}>{inv.invoice_no}</span></>}
        </button>
      ) : canIssue ? (
        <button type="button" className={compact ? 'mact' : 'btn btn-ghost btn-sm'} disabled={busy}
          title={t('invoice.issue')} onClick={start}>
          {compact ? '🧾+' : <>🧾 {inv ? t('invoice.reissue') : t('invoice.issue')}</>}
        </button>
      ) : null}
      {err && !asking && <small style={{ color: 'var(--danger)', display: 'block', fontSize: 11.5 }}>{err}</small>}

      {asking && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setAsking(false)}>
          <div className="modal" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-label={t('invoice.issueTitle')}>
            <h2>{t('invoice.issueTitle')}</h2>
            <p className="sub">{fmtNum(payment.amount)} {t('common.currency')} · {t('invoice.issueSub')}</p>
            {err && <div className="alert alert-error">{err}</div>}
            <VatField amount={payment.amount} value={vat} onChange={setVat} autoFocus />
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={!vatOk || busy} onClick={() => issue(vat)}>
                {busy ? t('common.saving') : t('invoice.issue')}
              </button>
              <button className="btn btn-ghost" onClick={() => setAsking(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {openId && <InvoiceModal invoiceId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  )
}
