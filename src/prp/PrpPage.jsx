// قسم البلازما — الباقات بشريط تقدم ●●○○
// + بطاقة الجلسات القادمة (٤٨ ساعة) + بطاقة المنقطعين (فرص إعادة تنشيط)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, fmtNum, openWhatsApp } from '../lib/format'
import ProgressDots from './ProgressDots'
import PrpDrawer from './PrpDrawer'

const STATUS_AR = {
  active:    { label: 'نشطة',    cls: 'badge-active' },
  completed: { label: 'مكتملة',  cls: 'badge-active' },
  dropped:   { label: 'منقطعة',  cls: 'badge-suspended' },
}

// رقم صالح لرابط واتساب: أرقام فقط بدون + أو مسافات
export default function PrpPage() {
  const { profile, isManager, roleCode } = useAuth()
  const [rows, setRows] = useState([])
  const [reminders, setReminders] = useState([])
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [openPkg, setOpenPkg] = useState(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [copied, setCopied] = useState(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [mineCount, setMineCount] = useState(0)
  const [staleCount, setStaleCount] = useState(0)

  // البحث بـ debounce — الاستعلام يستنى توقف الكتابة 300ms
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const myId = profile?.id
  const mineFilter = myId ? `coordinator_id.eq.${myId},agent_id.eq.${myId}` : null

  // صفحة واحدة + العدد الكلي — البحث والفلاتر في القاعدة
  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_prp_progress').select('*', { count: 'exact' })
    if (status) q = q.eq('status', status)
    if (mineOnly && mineFilter) q = q.or(mineFilter)
    const term = debounced.replace(/[,()%*\\]/g, ' ').trim()
    if (term) {
      const conds = [`full_name.ilike.%${term}%`, `file_no.ilike.%${term}%`]
      const digits = term.replace(/\D/g, '').replace(/^0+/, '')
      if (digits.length >= 3) conds.push(`phone_norm.ilike.%${digits}%`)
      q = q.or(conds.join(','))
    }
    // الأقرب جلسة الأول، واللي من غير جلسة قادمة في الآخر (الأحدث قبل الأقدم)
    q = q.order('next_session', { ascending: true, nullsFirst: false })
         .order('package_id', { ascending: false })
         .range(page * pageSize, page * pageSize + pageSize - 1)

    // عدّادات مستقلة عن الصفحة: "مرضاي" والمنقطعين (نشطة وآخر جلسة من أكتر من 45 يوم)
    let mineQ = supabase.from('v_prp_progress').select('package_id', { count: 'exact', head: true })
    if (status) mineQ = mineQ.eq('status', status)
    const staleQ = supabase.from('v_prp_progress').select('package_id', { count: 'exact', head: true })
      .eq('status', 'active').gt('days_since_last', 45)

    const [{ data: pr, count }, { data: rem }, mine, st] = await Promise.all([
      q,
      supabase.from('v_prp_upcoming_reminders').select('*').order('planned_date'),
      mineFilter ? mineQ.or(mineFilter) : Promise.resolve({ count: 0 }),
      staleQ,
    ])
    setRows(pr ?? [])
    setTotal(count ?? 0)
    setReminders(rem ?? [])
    setMineCount(mine.count ?? 0)
    setStaleCount(st.count ?? 0)
    setLoading(false)
  }, [status, mineOnly, mineFilter, debounced, page, pageSize])

  useEffect(() => { load() }, [load])
  // أي تغيير في الفلاتر يرجّع لأول صفحة
  useEffect(() => { setPage(0) }, [status, mineOnly, debounced, pageSize])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // هل هذه الباقة تخصّني؟ (المنسقة تعدّل باقات ديلاتها فقط)
  const isMine = (r) => !!myId && (r.coordinator_id === myId || r.agent_id === myId)

  // من يملك صلاحية التعديل على كل الباقات
  const canEditAll = isManager || roleCode === 'prp_officer'

  const visible = rows

  return (
    <>
      <div className="page-head">
        <div>
          <h1>قسم البلازما</h1>
          <div className="hint">{total.toLocaleString('en-US')} باقة — تُفتح تلقائيًا عند إتمام أي عملية (Done)</div>
        </div>
      </div>

      {/* جلسات خلال ٤٨ ساعة — تذكير */}
      {reminders.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--primary)', borderWidth: 1.5 }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <h2 style={{ fontSize: 15, color: 'var(--primary)' }}>جلسات خلال ٤٨ ساعة — ذكّر المرضى</h2>
          </div>
          <table className="table">
            <thead><tr><th>المريض</th><th>الهاتف</th><th>موعد الجلسة</th></tr></thead>
            <tbody>
              {reminders.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td>
                    <div className="phone-cell">
                      <span dir="ltr">{r.phone ?? '—'}</span>
                      {r.phone && (
                        <>
                          <a className="icon-btn" href={`tel:${r.phone}`} title="اتصال">☎</a>
                          <button className="icon-btn" title="واتساب"
                            onClick={() => openWhatsApp(r.phone)}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                            </svg>
                          </button>
                          <button className="icon-btn" title="نسخ الرقم"
                            onClick={() => navigator.clipboard?.writeText(r.phone)}>⧉</button>
                        </>
                      )}
                    </div>
                  </td>
                  <td>{fmtDate(r.planned_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* منقطعون — فرص إعادة تنشيط */}
      {staleCount > 0 && status === 'active' && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--warn)', borderWidth: 1.5 }}>
          <div style={{ padding: '14px 16px 12px' }}>
            <h2 style={{ fontSize: 15, color: 'var(--warn)' }}>
              {staleCount.toLocaleString('en-US')} مريض بلا جلسة منذ أكثر من ٤٥ يومًا — فرصة إعادة تواصل
            </h2>
          </div>
        </div>
      )}

      <div className="card filters-bar">
        <input className="filter-search" placeholder="بحث بالاسم أو الهاتف أو رقم الملف…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">النشطة</option>
          <option value="completed">المكتملة</option>
          <option value="dropped">المنقطعة</option>
          <option value="">الكل</option>
        </select>
        {!canEditAll && (
          <button className={'chip' + (mineOnly ? ' on' : '')}
            onClick={() => setMineOnly(v => !v)}>
            مرضاي فقط ({mineCount.toLocaleString('en-US')})
          </button>
        )}
      </div>

      {loading ? <div className="empty">جارٍ التحميل…</div> :
       visible.length === 0 ? (
        <div className="card empty">
          <strong>لا باقات هنا</strong>
          عند تحويل أي ديل إلى "تمت العملية" تُفتح باقة تلقائيًا بجلساتها
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>المريض</th><th>الهاتف</th><th>المنسقة</th><th>السيلز</th>
                <th>التقدم</th><th>الجلسة القادمة</th><th>آخر جلسة</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.package_id} onClick={() => setOpenPkg(r)}
                  style={{
                    cursor: 'pointer',
                    // الباقات غير المملوكة تظهر باهتة للمنسقة والسيلز
                    opacity: canEditAll || isMine(r) ? 1 : .55,
                  }}>
                  <td style={{ fontWeight: 600 }}>
                    {r.full_name} <small style={{ color: 'var(--ink-soft)' }}>{r.file_no}</small>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="phone-cell">
                      <span dir="ltr">{r.phone ?? '—'}</span>
                      {r.phone && (
                        <>
                          <a className="icon-btn" href={`tel:${r.phone}`} title="اتصال">☎</a>
                          <button className="icon-btn" title="واتساب"
                            onClick={() => openWhatsApp(r.phone)}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                            </svg>
                          </button>
                          <button className="icon-btn" title="نسخ الرقم"
                            onClick={() => { navigator.clipboard?.writeText(r.phone); setCopied(r.package_id); setTimeout(() => setCopied(null), 1500) }}>
                            {copied === r.package_id ? '✓' : '⧉'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    {r.coordinator_name ?? '—'}
                    {isMine(r) && !canEditAll && (
                      <span className="badge badge-active" style={{ marginInlineStart: 6, fontSize: 11 }}>
                        مريضي
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{r.agent_name ?? '—'}</td>
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

      {!loading && total > 0 && (
        <div className="pager">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>لكل صفحة:</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ width: 80 }}>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          {total > pageSize && (
            <>
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>← السابق</button>
              <span className="pager-info">
                صفحة {(page + 1).toLocaleString('en-US')} من {totalPages.toLocaleString('en-US')}
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>التالي →</button>
            </>
          )}
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
