// تفاصيل المحصّل على ديل — كل الدفعات مع صور إيصالات الدفع (طلب المحاسب)
// بتتفتح بالضغط على عمود التحصيل في شاشة الديلات
// المحاسب/المدير: تأكيد محاسبي (فردي أو الكل) + إلغاء مباشر بسبب إجباري (void_payment_direct)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { dbErr } from '../lib/dbErrors'
import { fmtNum, fmtDateTime } from '../lib/format'
import { signedReceiptUrls, receiptKind } from '../finance/receipts'
import ReceiptViewer from '../finance/ReceiptViewer'
import useT from '../i18n/useT'

const SELECT = `
  id, receipt_no, amount, method, paid_at, reference, notes, status, void_reason,
  receipt_path, confirmed_at,
  received:profiles!payments_received_by_fkey(full_name),
  confirmer:profiles!payments_confirmed_by_fkey(full_name)
`

export default function DealPaymentsModal({ deal, onClose, onChanged }) {
  const { t, dn } = useT()
  const { profile, isManager, roleCode } = useAuth()
  const canAct = isManager || roleCode === 'accountant'
  const SAR = t('common.currency')
  const methodLabel = (m) => t(`payMethod.${m}`, { defaultValue: m })

  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  const [err, setErr] = useState('')
  const [viewAt, setViewAt] = useState(null)  // رقم الإيصال المفتوح في العارض
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiding, setVoiding] = useState(null)  // الدفعة اللي بتتلغي (نافذة السبب)
  const [reason, setReason] = useState('')
  const [voidedHere, setVoidedHere] = useState(0)  // مجموع اللي اتلغى من النافذة دي — لتحديث الملخص فورًا

  const loadRows = useCallback(async (alive = () => true) => {
    const { data, error } = await supabase.from('payments').select(SELECT)
      .eq('deal_id', deal.id)
      .order('paid_at', { ascending: true }).order('created_at', { ascending: true })
    if (!alive()) return
    if (error) { setErr(t('dealPays.loadFailed')); setRows([]); return }
    setRows(data ?? [])
    const map = await signedReceiptUrls((data ?? []).map(p => p.receipt_path))
    if (alive()) setUrls(map)
  }, [deal.id, t])

  useEffect(() => {
    let alive = true
    loadRows(() => alive)
    return () => { alive = false }
  }, [loadRows])

  // Esc يقفل النافذة (العارض أو نافذة السبب لما يكونوا مفتوحين بيقفلوا نفسهم الأول)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || viewAt != null) return
      if (voiding) { setVoiding(null); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewAt, voiding, onClose])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  async function confirmIds(ids) {
    if (!ids.length || busy) return
    if (ids.length > 1 && !window.confirm(t('payments.confirmBulkQ', { n: ids.length }))) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).in('id', ids).eq('status', 'active').is('confirmed_at', null)
    setBusy(false)
    if (error) { setErr(t('payments.err.confirm') + ' — ' + dbErr(error.message)); return }
    flash(ids.length > 1 ? t('payments.confirmedN', { n: ids.length }) : t('payments.confirmed'))
    await loadRows(); onChanged?.()
  }

  async function submitVoid() {
    const r = reason.trim()
    if (!r || !voiding || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('void_payment_direct', { p_payment_id: voiding.id, p_reason: r })
    setBusy(false)
    if (error) { setErr(t('payments.err.approveVoid') + ' — ' + dbErr(error.message)); return }
    // اللي كان active بس هو اللي كان محسوب في المحصّل
    if (voiding.status === 'active') setVoidedHere(v => v + (Number(voiding.amount) || 0))
    setVoiding(null); setReason('')
    flash(t('payments.voided'))
    await loadRows(); onChanged?.()
  }

  // قائمة العارض: الدفعات اللي ليها إيصال، ومعاها اسم العميل للعنوان
  const viewList = (rows ?? []).filter(p => p.receipt_path)
    .map(p => ({ ...p, deals: { leads: { full_name: deal.full_name } } }))
  const openView = (p) => setViewAt(Math.max(0, viewList.findIndex(x => x.id === p.id)))

  const due = Number(deal.total_amount) || 0
  const collected = Math.max(0, (Number(deal.collected) || 0) - voidedHere)
  const rem = Math.max(0, (Number(deal.open_remaining) || 0) + voidedHere)
  const unconfirmedIds = (rows ?? []).filter(p => p.status === 'active' && !p.confirmed_at).map(p => p.id)
  const closed = ['lost', 'cancelled'].includes(deal.status)
  const sale = dn({ name_ar: deal.procedure_name, name_en: deal.procedure_name_en }) || ''
  const branch = dn({ name: deal.branch_name, name_en: deal.branch_name_en }) || ''

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal paydlg" role="dialog" aria-modal="true" aria-label={t('dealPays.title')}>
        <h2>{t('dealPays.title')}</h2>
        <p className="sub">
          {deal.full_name ?? '—'}
          {deal.file_no ? ` · ${deal.file_no}` : ''}
          {sale ? ` · ${sale}` : ''}
          {branch ? ` · ${branch}` : ''}
        </p>

        <div className="paydlg-sum">
          <div><span>{t('dealPays.total')}</span><b>{fmtNum(due)} {SAR}</b></div>
          <div><span>{t('dealPays.collected')}</span><b className="ok">{fmtNum(collected)} {SAR}</b></div>
          <div>
            <span>{t('dealPays.remaining')}</span>
            {closed
              ? <b>—</b>
              : <b className={rem > 0 ? 'danger' : 'ok'}>{rem > 0 ? `${fmtNum(rem)} ${SAR}` : t('payStatus.paid')}</b>}
          </div>
        </div>

        {err && <div className="alert alert-error">{err}</div>}
        {msg && <div className="alert alert-ok">{msg}</div>}

        {canAct && unconfirmedIds.length > 1 && (
          <div className="paydlg-bulk">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirmIds(unconfirmedIds)}>
              {busy ? t('payments.confirming') : t('dealPays.confirmAll', { n: unconfirmedIds.length })}
            </button>
          </div>
        )}

        {rows == null ? (
          <div className="empty">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="empty">{t('dealPays.none')}</div>
        ) : (
          <ul className="paydlg-list">
            {rows.map((p, i) => {
              const isVoid = p.status === 'void'
              const isVoidReq = p.status === 'void_requested'
              const kind = receiptKind(p.receipt_path)
              const url = urls[p.receipt_path]
              return (
                <li key={p.id} className={'paydlg-item' + (isVoid ? ' is-void' : '')}>
                  <div className="paydlg-receipt">
                    {!p.receipt_path ? (
                      <div className="paydlg-noimg">{t('dealPays.noReceipt')}</div>
                    ) : kind === 'image' && url ? (
                      <button type="button" className="paydlg-thumb" onClick={() => openView(p)}
                        title={t('payments.viewReceipt')} aria-label={t('payments.viewReceipt')}>
                        <img src={url} alt={`${t('payments.receipt')} ${p.receipt_no}`} loading="lazy" />
                      </button>
                    ) : (
                      <button type="button" className="paydlg-file" onClick={() => openView(p)}>
                        <span aria-hidden="true">📄</span>
                        {kind === 'pdf' ? t('dealPays.pdf') : t('dealPays.file')}
                      </button>
                    )}
                  </div>

                  <div className="paydlg-info">
                    <div className="paydlg-top">
                      <span className="paydlg-amount">{fmtNum(p.amount)} {SAR}</span>
                      {isVoid
                        ? <span className="badge badge-suspended">{t('payments.st.void')}</span>
                        : isVoidReq
                          ? <span className="badge badge-pending">{t('payments.st.void_requested')}</span>
                          : p.confirmed_at
                            ? <span className="badge badge-active">{t('payments.confirmedBadge')}</span>
                            : <span className="badge badge-pending">{t('payments.awaitingAccountant')}</span>}
                    </div>
                    <div className="paydlg-meta">
                      <span>#{i + 1}</span>
                      <span dir="ltr">{p.receipt_no}</span>
                      <span>{fmtDateTime(p.paid_at)}</span>
                    </div>
                    <div className="paydlg-meta">
                      <span>{t('payments.method')}: <b>{methodLabel(p.method)}</b></span>
                      {p.reference && <span>{t('dealPays.ref')}: <b dir="ltr">{p.reference}</b></span>}
                    </div>
                    <div className="paydlg-meta">
                      <span>{t('payments.recordedBy')}: {p.received?.full_name ?? '—'}</span>
                      {p.confirmed_at && (
                        <span>{t('dealPays.confirmedBy')}: {p.confirmer?.full_name ?? '—'} · {fmtDateTime(p.confirmed_at)}</span>
                      )}
                    </div>
                    {p.notes && <div className="paydlg-note">{p.notes}</div>}
                    {(isVoid || isVoidReq) && p.void_reason && (
                      <div className="paydlg-note danger">{t('payments.voidReason')}: {p.void_reason}</div>
                    )}
                    {canAct && !isVoid && (
                      <div className="paydlg-acts">
                        {p.status === 'active' && !p.confirmed_at && (
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirmIds([p.id])}>
                            ✓ {t('dealPays.confirm')}
                          </button>
                        )}
                        <button className="btn btn-danger btn-sm" disabled={busy}
                          onClick={() => { setVoiding(p); setReason('') }}>
                          {isVoidReq ? t('dealPays.approveVoid') : t('dealPays.voidNow')}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>

      {voiding && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setVoiding(null)}>
          <div className="modal" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-label={t('dealPays.voidTitle')}>
            <h2>{t('dealPays.voidTitle')}</h2>
            <p className="sub">
              {fmtNum(voiding.amount)} {SAR} · <span dir="ltr">{voiding.receipt_no}</span>
              <br />{voiding.status === 'void_requested' ? t('dealPays.voidSubPending') : t('dealPays.voidSub')}
            </p>
            <div className="field">
              <label>{t('payments.voidReason')}</label>
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder={t('payments.voidPh')}
                onKeyDown={e => e.key === 'Enter' && submitVoid()} autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={submitVoid} disabled={!reason.trim() || busy}>
                {t('dealPays.voidConfirm')}
              </button>
              <button className="btn btn-ghost" onClick={() => setVoiding(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {viewAt != null && (
        <ReceiptViewer list={viewList} index={viewAt} onClose={() => setViewAt(null)} />
      )}
    </div>
  )
}
