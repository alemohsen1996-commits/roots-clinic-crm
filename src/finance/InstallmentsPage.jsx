// الأقساط والمتأخرات
// قسمان: المتأخرات + الأقساط القادمة — كلاهما من جدول installments مباشرة
// حتى نملك id القسط ونستطيع إقفاله عند السداد (كان مفقودًا في المتأخرات)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum, fmtDate } from '../lib/format'
import AddPaymentModal from './AddPaymentModal'
import ScheduleModal from './ScheduleModal'

const SELECT = `
  id, seq_no, amount, paid_amount, due_date, status,
  deals(id, leads(file_no, full_name),
        coordinator:profiles!deals_coordinator_id_fkey(full_name))
`

const today = () => new Date().toISOString().slice(0, 10)

function daysOverdue(due) {
  const d = Math.floor((Date.now() - new Date(due + 'T00:00:00').getTime()) / 86400000)
  return d > 0 ? d : 0
}

function bucket(days) {
  if (days <= 30) return { label: '1-30 يوم', color: 'var(--warn)' }
  if (days <= 60) return { label: '31-60 يوم', color: '#c2410c' }
  if (days <= 90) return { label: '61-90 يوم', color: 'var(--danger)' }
  return { label: 'أكثر من 90 يوم', color: '#7f1d1d' }
}

const remainingOf = (i) => Number(i.amount) - Number(i.paid_amount ?? 0)

export default function InstallmentsPage() {
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
      setErr('تعذر تحميل الأقساط — ' + (ov.error?.message || up.error?.message))
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
    installment_label: `القسط #${i.seq_no}`,
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الأقساط والمتأخرات</h1>
          <div className="hint">
            {overdue.length > 0
              ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                  {fmtNum(overdueTotal)} ر.س متأخرة على {overdue.length} قسط
                </span>
              : 'لا توجد متأخرات — ممتاز'}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowSchedule(true)}>+ جدولة أقساط</button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? <div className="empty">جارٍ التحميل…</div> : (
        <>
          {/* المتأخرات */}
          {overdue.length > 0 && (
            <div className="card" style={{ marginBottom: 20, borderColor: 'var(--danger)', borderWidth: 1.5 }}>
              <div style={{ padding: '14px 16px 4px' }}>
                <h2 style={{ fontSize: 15, color: 'var(--danger)' }}>متأخرات تحتاج متابعة</h2>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>العميل</th><th>القسط</th><th>المتبقي</th>
                    <th>الاستحقاق</th><th>التأخير</th><th>المنسقة</th><th></th>
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
                        <td>
                          #{r.seq_no}
                          {r.status === 'partial' && (
                            <span className="badge badge-pending" style={{ marginInlineStart: 6 }}>جزئي</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {fmtNum(rem)} ر.س
                          {Number(r.paid_amount) > 0 && (
                            <small style={{ color: 'var(--ink-soft)', display: 'block' }}>
                              سُدِّد {fmtNum(r.paid_amount)} من {fmtNum(r.amount)}
                            </small>
                          )}
                        </td>
                        <td>{fmtDate(r.due_date)}</td>
                        <td>
                          <span className="badge" style={{ background: b.color + '22', color: b.color }}>
                            {d} يوم · {b.label}
                          </span>
                        </td>
                        <td>{r.deals?.coordinator?.full_name ?? '—'}</td>
                        <td>
                          <button className="btn btn-primary" onClick={() => setPayPreset(presetFor(r))}>
                            تحصيل
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
              <h2 style={{ fontSize: 15 }}>الأقساط القادمة</h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="empty">
                <strong>لا أقساط قادمة</strong>
                استخدم "جدولة أقساط" لتقسيم متبقي أي ديل على دفعات بتواريخ
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>العميل</th><th>القسط</th><th>المتبقي</th><th>الاستحقاق</th><th></th></tr>
                </thead>
                <tbody>
                  {upcoming.map(i => (
                    <tr key={i.id}>
                      <td style={{ fontWeight: 600 }}>
                        {i.deals?.leads?.full_name}
                        <small style={{ color: 'var(--ink-soft)' }}> · {i.deals?.leads?.file_no}</small>
                      </td>
                      <td>
                        #{i.seq_no}
                        {i.status === 'partial' && (
                          <span className="badge badge-pending" style={{ marginInlineStart: 6 }}>جزئي</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {fmtNum(remainingOf(i))} ر.س
                        {Number(i.paid_amount) > 0 && (
                          <small style={{ color: 'var(--ink-soft)', display: 'block' }}>
                            سُدِّد {fmtNum(i.paid_amount)} من {fmtNum(i.amount)}
                          </small>
                        )}
                      </td>
                      <td>{fmtDate(i.due_date)}</td>
                      <td>
                        <button className="btn btn-ghost" onClick={() => setPayPreset(presetFor(i))}>
                          تسجيل سداد
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
