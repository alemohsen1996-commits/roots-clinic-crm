// قسم البلازما — الباقات بشريط تقدم ●●○○
// + بطاقة الجلسات القادمة (٤٨ ساعة) + بطاقة المنقطعين (فرص إعادة تنشيط)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtNum } from '../lib/format'
import ProgressDots from './ProgressDots'
import PrpDrawer from './PrpDrawer'

const STATUS_AR = {
  active:    { label: 'نشطة',    cls: 'badge-active' },
  completed: { label: 'مكتملة',  cls: 'badge-active' },
  dropped:   { label: 'منقطعة',  cls: 'badge-suspended' },
}

// رقم صالح لرابط واتساب: أرقام فقط بدون + أو مسافات
const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

export default function PrpPage() {
  const [rows, setRows] = useState([])
  const [reminders, setReminders] = useState([])
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [openPkg, setOpenPkg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_prp_progress').select('*')
    if (status) q = q.eq('status', status)
    const [{ data: pr }, { data: rem }] = await Promise.all([
      q,
      supabase.from('v_prp_upcoming_reminders').select('*').order('planned_date'),
    ])
    setRows(pr ?? [])
    setReminders(rem ?? [])
    setLoading(false)
  }, [status])

  useEffect(() => { load() }, [load])

  const visible = rows.filter(r =>
    !search.trim() || r.full_name?.includes(search.trim()) || r.file_no?.includes(search.trim()))

  // المنقطعون فعليًا: نشطة لكن آخر جلسة من أكثر من 45 يوم
  const stale = rows.filter(r =>
    r.status === 'active' && r.days_since_last !== null && r.days_since_last > 45)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>قسم البلازما</h1>
          <div className="hint">{visible.length} باقة — تُفتح تلقائيًا عند إتمام أي عملية (Done)</div>
        </div>
      </div>

      {/* جلسات خلال ٤٨ ساعة — تذكير */}
      {reminders.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--primary)', borderWidth: 1.5 }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <h2 style={{ fontSize: 15, color: 'var(--primary)' }}>جلسات خلال ٤٨ ساعة — ذكّر المرضى</h2>
          </div>
          <table className="table">
            <thead><tr><th>المريض</th><th>الهاتف</th><th>موعد الجلسة</th><th>تواصل</th></tr></thead>
            <tbody>
              {reminders.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>{r.phone}</td>
                  <td>{fmtDate(r.planned_date)}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <a className="btn btn-ghost btn-sm" href={`tel:${r.phone}`}>اتصال</a>
                    <a className="btn btn-ghost btn-sm"
                      href={`https://wa.me/${waNumber(r.phone)}`}
                      target="_blank" rel="noreferrer">واتساب</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* منقطعون — فرص إعادة تنشيط */}
      {stale.length > 0 && status === 'active' && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--warn)', borderWidth: 1.5 }}>
          <div style={{ padding: '14px 16px 12px' }}>
            <h2 style={{ fontSize: 15, color: 'var(--warn)' }}>
              {stale.length} مريض بلا جلسة منذ أكثر من ٤٥ يومًا — فرصة إعادة تواصل
            </h2>
          </div>
        </div>
      )}

      <div className="card filters-bar">
        <input className="filter-search" placeholder="بحث بالاسم أو رقم الملف…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">النشطة</option>
          <option value="completed">المكتملة</option>
          <option value="dropped">المنقطعة</option>
          <option value="">الكل</option>
        </select>
      </div>

      {loading ? <div className="empty">جارٍ التحميل…</div> :
       visible.length === 0 ? (
        <div className="card empty">
          <strong>لا باقات هنا</strong>
          عند تحويل أي ديل إلى "تمت العملية" تُفتح باقة تلقائيًا بجلساتها
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>المريض</th><th>التقدم</th><th>الجلسة القادمة</th>
                <th>آخر جلسة</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.package_id} onClick={() => setOpenPkg(r)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 600 }}>
                    {r.full_name} <small style={{ color: 'var(--ink-soft)' }}>{r.file_no}</small>
                  </td>
                  <td>
                    <ProgressDots done={r.sessions_done} total={r.sessions_total} />
                    <small style={{ color: 'var(--ink-soft)', marginInlineStart: 8 }}>
                      {fmtNum(r.sessions_done)}/{fmtNum(r.sessions_total)}
                    </small>
                  </td>
                  <td>{fmtDate(r.next_session)}</td>
                  <td>
                    {r.last_session_date
                      ? <>{fmtDate(r.last_session_date)}
                          {r.days_since_last > 45 &&
                            <span className="badge badge-pending" style={{ marginInlineStart: 6 }}>
                              منذ {r.days_since_last} يوم
                            </span>}
                        </>
                      : '—'}
                  </td>
                  <td>
                    <span className={'badge ' + STATUS_AR[r.status]?.cls}>
                      {STATUS_AR[r.status]?.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openPkg && (
        <PrpDrawer
          packageId={openPkg.package_id}
          onClose={() => setOpenPkg(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
