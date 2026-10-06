// تفاصيل المحصّل على ديل — كل الدفعات مع صور إيصالات الدفع (طلب المحاسب)
// بتتفتح بالضغط على عمود التحصيل في شاشة الديلات
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
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

export default function DealPaymentsModal({ deal, onClose }) {
  const { t, dn } = useT()
  const SAR = t('common.currency')
  const methodLabel = (m) => t(`payMethod.${m}`, { defaultValue: m })

  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  const [err, setErr] = useState('')
  const [viewAt, setViewAt] = useState(null)  // رقم الإيصال المفتوح في العارض

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.from('payments').select(SELECT)
        .eq('deal_id', deal.id)
        .order('paid_at', { ascending: true }).order('created_at', { ascending: true })
      if (!alive) return
      if (error) { setErr(t('dealPays.loadFailed')); setRows([]); return }
      setRows(data ?? [])
      const map = await signedReceiptUrls((data ?? []).map(p => p.receipt_path))
      if (alive) setUrls(map)
    })()
    return () => { alive = false }
  }, [deal.id, t])

  // Esc يقفل النافذة (العارض لما يكون مفتوح بيقفل نفسه الأول)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && viewAt == null) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewAt, onClose])

  // قائمة العارض: الدفعات اللي ليها إيصال، ومعاها اسم العميل للعنوان
  const viewList = (rows ?? []).filter(p => p.receipt_path)
    .map(p => ({ ...p, deals: { leads: { full_name: deal.full_name } } }))
  const openView = (p) => setViewAt(Math.max(0, viewList.findIndex(x => x.id === p.id)))

  const due = Number(deal.total_amount) || 0
  const collected = Number(deal.collected) || 0
  const rem = Number(deal.open_remaining) || 0
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

      {viewAt != null && (
        <ReceiptViewer list={viewList} index={viewAt} onClose={() => setViewAt(null)} />
      )}
    </div>
  )
}
