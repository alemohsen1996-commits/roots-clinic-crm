// الأقساط والمتأخرات
// قسمان: المتأخرات + الأقساط القادمة — كلاهما من جدول installments مباشرة
// حتى نملك id القسط ونستطيع إقفاله عند السداد (كان مفقودًا في المتأخرات)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum, fmtDate, openWhatsApp } from '../lib/format'
import AddPaymentModal from './AddPaymentModal'
import ScheduleModal from './ScheduleModal'
import useT from '../i18n/useT'
import i18n from '../i18n'

const SELECT = `
  id, seq_no, amount, paid_amount, due_date, status,
  deals(id, leads(file_no, full_name, phone),
        coordinator:profiles!deals_coordinator_id_fkey(full_name))
`

const today = () => new Date().toISOString().slice(0, 10)

function daysOverdue(due) {
  const d = Math.floor((Date.now() - new Date(due + 'T00:00:00').getTime()) / 86400000)
  return d > 0 ? d : 0
}

function bucket(days) {
  const dy = i18n.t('installments.dayUnit')
  if (days <= 30) return { label: `1-30 ${dy}`, color: 'var(--warn)' }
  if (days <= 60) return { label: `31-60 ${dy}`, color: 'color-mix(in srgb, var(--warn) 45%, var(--danger))' }
  if (days <= 90) return { label: `61-90 ${dy}`, color: 'var(--danger)' }
  return { label: i18n.t('installments.over90'), color: 'color-mix(in srgb, var(--danger) 70%, var(--ink))' }
}

const remainingOf = (i) => Number(i.amount) - Number(i.paid_amount ?? 0)

function PhoneCell({ phone }) {
  const { t } = useT()
  if (!phone) return <span style={{ color: 'var(--ink-soft)' }}>—</span>
  return (
    <div className="phone-cell">
      <span dir="ltr">{phone}</span>
      <a className="icon-btn" href={`tel:${phone}`} title={t('lead.call')}>☎</a>
      <button className="icon-btn" title="WhatsApp"
                            onClick={() => openWhatsApp(phone)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
        </svg>
      </button>
      <button className="icon-btn" title={t('lead.copyPhone')}
        onClick={() => navigator.clipboard?.writeText(phone)}>⧉</button>
    </div>
  )
}

export default function InstallmentsPage() {
  const { t } = useT()
  const SAR = t('common.currency')
  const [overdue, setOverdue] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [payPreset, setPayPreset] = useState(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const t = today()
    const [ov, up] = await Promise.all([
      supabase.from('installments').select(SELECT)
        .in('status', ['pending', 'partial', 'overdue'])
        .lt('due_date', t)
        .order('due_date')
        .limit(300),
      supabase.from('installments').select(SELECT)
        .in('status', ['pending', 'partial'])
        .gte('due_date', t)
        .order('due_date')
        .limit(200),
    ])
    if (ov.error || up.error) {
      setErr(t('installments.loadFailed') + ' — ' + (ov.error?.message || up.error?.message))
    }
    setOverdue(ov.data ?? [])
    setUpcoming(up.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const overdueTotal = overdue.reduce((a, r) => a + remainingOf(r), 0)

  // بناء بيانات نافذة السداد — الآن مع id القسط في الحالتين
  const presetFor = (i) => ({
    deal_id: i.deals?.id,
    amount: remainingOf(i),
    installment_id: i.id,
    client: i.deals?.leads?.full_name,
    installment_label: t('payment.installmentNo', { n: i.seq_no }),
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.installments')}</h1>
          <div className="hint">
            {overdue.length > 0
              ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                  {t('installments.overdueSummary', { amount: fmtNum(overdueTotal), cur: SAR, n: overdue.length })}
                </span>
              : t('installments.noOverdue')}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowSchedule(true)}>+ {t('schedule.title')}</button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? <div className="empty">{t('common.loading')}</div> : (
        <>
          {/* المتأخرات */}
          {overdue.length > 0 && (
            <div className="card" style={{ marginBottom: 20, borderColor: 'var(--danger)', borderWidth: 1.5 }}>
              <div style={{ padding: '14px 16px 4px' }}>
                <h2 style={{ fontSize: 15, color: 'var(--danger)' }}>{t('installments.overdueTitle')}</h2>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{t('lead.client')}</th><th>{t('lead.phone')}</th><th>{t('schedule.installment')}</th><th>{t('deals.sorts.remaining')}</th>
                    <th>{t('schedule.due')}</th><th>{t('installments.delay')}</th><th>{t('lead.coordShort')}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map(r => {
                    const d = daysOverdue(r.due_date)
                    const b = bucket(d)
                    const rem = remainingOf(r)
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>
                          {r.deals?.leads?.full_name}
                          <small style={{ color: 'var(--ink-soft)' }}> · {r.deals?.leads?.file_no}</small>
                        </td>
                        <td><PhoneCell phone={r.deals?.leads?.phone} /></td>
                        <td>
                          #{r.seq_no}
                          {r.status === 'partial' && (
                            <span className="badge badge-pending" style={{ marginInlineStart: 6 }}>{t('payStatus.partial')}</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {fmtNum(rem)} {SAR}
                          {Number(r.paid_amount) > 0 && (
                            <small style={{ color: 'var(--ink-soft)', display: 'block' }}>
                              {t('installments.paidOf', { paid: fmtNum(r.paid_amount), total: fmtNum(r.amount) })}
                            </small>
                          )}
                        </td>
                        <td>{fmtDate(r.due_date)}</td>
                        <td>
                          <span className="badge stage-pill" style={{ '--stage': b.color }}>
                            {d} {t('installments.dayUnit')} · {b.label}
                          </span>
                        </td>
                        <td>{r.deals?.coordinator?.full_name ?? '—'}</td>
                        <td>
                          <button className="btn btn-primary" onClick={() => setPayPreset(presetFor(r))}>
                            {t('installments.collect')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* الأقساط القادمة */}
          <div className="card">
            <div style={{ padding: '14px 16px 4px' }}>
              <h2 style={{ fontSize: 15 }}>{t('installments.upcoming')}</h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="empty">
                <strong>{t('installments.noUpcoming')}</strong>
                {t('installments.noUpcomingHint')}
              </div>
            ) : (
              <table className="table compact">
                <thead>
                  <tr><th>{t('lead.client')}</th><th>{t('lead.phone')}</th><th>{t('schedule.installment')}</th><th>{t('deals.sorts.remaining')}</th><th>{t('schedule.due')}</th><th></th></tr>
                </thead>
                <tbody>
                  {upcoming.map(i => (
                    <tr key={i.id}>
                      <td style={{ fontWeight: 600 }}>
                        {i.deals?.leads?.full_name}
                        <small style={{ color: 'var(--ink-soft)' }}> · {i.deals?.leads?.file_no}</small>
                      </td>
                      <td><PhoneCell phone={i.deals?.leads?.phone} /></td>
                      <td>
                        #{i.seq_no}
                        {i.status === 'partial' && (
                          <span className="badge badge-pending" style={{ marginInlineStart: 6 }}>{t('payStatus.partial')}</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {fmtNum(remainingOf(i))} {SAR}
                        {Number(i.paid_amount) > 0 && (
                          <small style={{ color: 'var(--ink-soft)', display: 'block' }}>
                            {t('installments.paidOf', { paid: fmtNum(i.paid_amount), total: fmtNum(i.amount) })}
                          </small>
                        )}
                      </td>
                      <td>{fmtDate(i.due_date)}</td>
                      <td>
                        <button className="btn btn-ghost" onClick={() => setPayPreset(presetFor(i))}>
                          {t('installments.recordPayment')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {payPreset && (
        <AddPaymentModal
          preset={payPreset}
          onClose={() => setPayPreset(null)}
          onSaved={() => { setPayPreset(null); load() }}
        />
      )}

      {showSchedule && (
        <ScheduleModal
          onClose={() => setShowSchedule(false)}
          onSaved={() => { setShowSchedule(false); load() }}
        />
      )}
    </>
  )
}
