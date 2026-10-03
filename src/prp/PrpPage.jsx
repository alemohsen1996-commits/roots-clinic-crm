// قسم البلازما — أرقام الشهر + قوايم الشغل اليومية (جلسات متسجلتش / المتابعة)
// + بطاقة الجلسات القادمة (٤٨ ساعة) + الباقات بشريط تقدم ●●○○
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, fmtNum, fmtMonth, openWhatsApp } from '../lib/format'
import ProgressDots from './ProgressDots'
import PrpDrawer from './PrpDrawer'
import PrpMonthStats, { usePrpMonthStats, lastMonths } from './PrpMonthStats'
import { UnrecordedSessions, FollowupList } from './PrpWorkLists'
import useT from '../i18n/useT'

// الأسماء في الترجمة: prpStatus.*
const STATUS_CLS = { active: 'badge-active', completed: 'badge-active', dropped: 'badge-suspended' }

// رقم صالح لرابط واتساب: أرقام فقط بدون + أو مسافات
export default function PrpPage() {
  const { profile, isManager, roleCode } = useAuth()
  const { t } = useT()
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
  const [unrecorded, setUnrecorded] = useState([])
  const [followups, setFollowups] = useState([])
  const [month, setMonth] = useState(() => lastMonths(1)[0])
  const [refreshKey, setRefreshKey] = useState(0)
  const months = lastMonths(12)
  const { stats, loading: statsLoading } = usePrpMonthStats(month, null, refreshKey)

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

    // عدّاد "مرضاي" مستقل عن الصفحة
    let mineQ = supabase.from('v_prp_progress').select('package_id', { count: 'exact', head: true })
    if (status) mineQ = mineQ.eq('status', status)

    // قوايم الشغل — مع "مرضاي فقط" تتقصر على مرضى المستخدم
    let unQ = supabase.from('v_prp_unrecorded').select('*').order('planned_date')
    let fuQ = supabase.from('v_prp_followup').select('*')
      .order('days_idle', { ascending: false }).order('package_id')
    if (mineOnly && mineFilter) { unQ = unQ.or(mineFilter); fuQ = fuQ.or(mineFilter) }

    const [{ data: pr, count }, { data: rem }, mine, { data: un }, { data: fu }] = await Promise.all([
      q,
      supabase.from('v_prp_upcoming_reminders').select('*').order('planned_date'),
      mineFilter ? mineQ.or(mineFilter) : Promise.resolve({ count: 0 }),
      unQ,
      fuQ,
    ])
    setRows(pr ?? [])
    setTotal(count ?? 0)
    setReminders(rem ?? [])
    setMineCount(mine.count ?? 0)
    setUnrecorded(un ?? [])
    setFollowups(fu ?? [])
    setLoading(false)
  }, [status, mineOnly, mineFilter, debounced, page, pageSize])

  // بعد أي تسجيل: القوايم + الجدول + أرقام الشهر
  const refreshAll = useCallback(() => { load(); setRefreshKey(k => k + 1) }, [load])

  useEffect(() => { load() }, [load])
  // أي تغيير في الفلاتر يرجّع لأول صفحة
  useEffect(() => { setPage(0) }, [status, mineOnly, debounced, pageSize])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // هل هذه الباقة تخصّني؟ (المنسقة تعدّل باقات ديلاتها فقط)
  const isMine = (r) => !!myId && (r.coordinator_id === myId || r.agent_id === myId)

  // من يملك صلاحية التعديل على كل الباقات
  const canEditAll = isManager || roleCode === 'prp_officer'

  const visible = rows

  // صلاحية التسجيل على صف: المدير · موظف البلازما · منسقة الديل نفسها
  const canAct = {
    profile,
    can: (r) => canEditAll || (!!myId && r.coordinator_id === myId),
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.prp')}</h1>
          <div className="hint">{t('prp.hint', { n: total.toLocaleString('en-US') })}</div>
        </div>
      </div>

      {/* أرقام الشهر */}
      <div className="prp-month-head">
        <h2>{t('prp.monthNumbers', { month: fmtMonth(month) })}</h2>
        <select aria-label={t('common.month')} value={month} onChange={e => setMonth(e.target.value)} style={{ minWidth: 170 }}>
          {months.map((m, i) => (
            <option key={m} value={m}>{fmtMonth(m)}{i === 0 ? ` (${t('common.current')})` : ''}</option>
          ))}
        </select>
      </div>
      <PrpMonthStats stats={stats} loading={statsLoading} />

      {/* قوايم الشغل اليومية */}
      <UnrecordedSessions rows={unrecorded} canAct={canAct} onChanged={refreshAll} />
      <FollowupList rows={followups} canAct={canAct} onChanged={refreshAll}
        onOpen={(r) => setOpenPkg({ package_id: r.package_id })} />

      {/* جلسات خلال ٤٨ ساعة — تذكير */}
      {reminders.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--primary)', borderWidth: 1.5 }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <h2 style={{ fontSize: 15, color: 'var(--primary)' }}>{t('prp.next48')}</h2>
          </div>
          <table className="table">
            <thead><tr><th>{t('statements.patient')}</th><th>{t('lead.phone')}</th><th>{t('prp.sessionDate')}</th></tr></thead>
            <tbody>
              {reminders.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td>
                    <div className="phone-cell">
                      <span dir="ltr">{r.phone ?? '—'}</span>
                      {r.phone && (
                        <>
                          <a className="icon-btn" href={`tel:${r.phone}`} title={t('lead.call')}>☎</a>
                          <button className="icon-btn" title="WhatsApp"
                            onClick={() => openWhatsApp(r.phone)}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                            </svg>
                          </button>
                          <button className="icon-btn" title={t('lead.copyPhone')}
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

      <div className="card filters-bar">
        <input className="filter-search" placeholder={t('leads.searchPh')}
          value={search} onChange={e => setSearch(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">{t('prpStatus.active')}</option>
          <option value="completed">{t('prpStatus.completed')}</option>
          <option value="dropped">{t('prpStatus.dropped')}</option>
          <option value="">{t('common.all')}</option>
        </select>
        {!canEditAll && (
          <button className={'chip' + (mineOnly ? ' on' : '')}
            onClick={() => setMineOnly(v => !v)}>
            {t('prp.mineOnly')} ({mineCount.toLocaleString('en-US')})
          </button>
        )}
      </div>

      {loading ? <div className="empty">{t('common.loading')}</div> :
       visible.length === 0 ? (
        <div className="card empty">
          <strong>{t('prp.noPackages')}</strong>
          {t('prp.noPackagesHint')}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('statements.patient')}</th><th>{t('lead.phone')}</th><th>{t('lead.coordShort')}</th><th>{t('rolesShort.agent')}</th>
                <th>{t('prp.progress')}</th><th>{t('prp.nextSession')}</th><th>{t('prp.lastSession')}</th><th>{t('deals.status')}</th>
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
                          <a className="icon-btn" href={`tel:${r.phone}`} title={t('lead.call')}>☎</a>
                          <button className="icon-btn" title="WhatsApp"
                            onClick={() => openWhatsApp(r.phone)}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                            </svg>
                          </button>
                          <button className="icon-btn" title={t('lead.copyPhone')}
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
                        {t('prp.myPatient')}
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
                              {t('prp.daysAgo', { n: r.days_since_last })}
                            </span>}
                        </>
                      : '—'}
                  </td>
                  <td>
                    <span className={'badge ' + (STATUS_CLS[r.status] ?? '')}>
                      {t(`prpStatus.${r.status}`, { defaultValue: r.status })}
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
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('common.perPage')}</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ width: 80 }}>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          {total > pageSize && (
            <>
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>{t('common.prev')}</button>
              <span className="pager-info">
                {t('common.pageOf', { page: (page + 1).toLocaleString('en-US'), total: totalPages.toLocaleString('en-US') })}
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
            </>
          )}
        </div>
      )}

      {openPkg && (
        <PrpDrawer
          packageId={openPkg.package_id}
          onClose={() => setOpenPkg(null)}
          onChanged={refreshAll}
        />
      )}
    </>
  )
}
