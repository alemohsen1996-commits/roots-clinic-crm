// لوحة التحكم — أرقام أي شهر (للموظف وللمدير)
// تُحسب من الديلات والدفعات مباشرة، فتعمل لأي شهر مضى
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtMonth, cur as curSym } from '../lib/format'
import useT from '../i18n/useT'
import PrpMonthStats, { usePrpMonthStats, lastMonths } from '../prp/PrpMonthStats'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US')

const monthKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}
const thisMonth = () => monthKey(new Date())

const monthLabel = (m) => fmtMonth(m)

// تابات جدول أداء الفريق (العناوين من dashboard.tabs.*)
const TEAM_TABS = ['all', 'sales', 'coordinator']
const tabOf = (code) =>
  code === 'agent' ? 'sales' : code === 'coordinator' ? 'coordinator' : 'other'
const hasNumbers = (r) =>
  ['deals_count', 'revenue', 'collected', 'leads_received'].some(k => Number(r[k] ?? 0) > 0)

// سهم التغيّر مقارنة بالشهر السابق
function Delta({ now, before }) {
  const { t } = useT()
  if (before === undefined || before === null) return null
  const b = Number(before), n = Number(now)
  if (!b) return null
  const pct = Math.round(((n - b) / b) * 100)
  if (pct === 0) {
    return <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{t('dashboard.vsPrevSame')}</span>
  }
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: pct > 0 ? 'var(--ok)' : 'var(--danger)' }}>
      {pct > 0 ? '▲' : '▼'} {t('dashboard.vsPrev', { pct: Math.abs(pct) })}
    </span>
  )
}

export default function Dashboard() {
  const { t } = useT()
  const { profile, isManager, roleCode } = useAuth()
  const isPrp = roleCode === 'prp_officer'   // موظف البلازما: داشبورد البلازما بدل العمليات
  const [rows, setRows] = useState([])       // أداء الفريق (للشهر المختار)
  const [series, setSeries] = useState([])   // سلسلة الشهور
  const [month, setMonth] = useState(thisMonth())
  const [target, setTarget] = useState(0)
  const [loading, setLoading] = useState(true)
  const [teamTab, setTeamTab] = useState('all')

  // أداء الفريق — للشهر المختار (أي شهر مضى أو الجاري)
  const [teamLoading, setTeamLoading] = useState(false)
  const loadTeam = useCallback(async ({ quiet = false } = {}) => {
    if (!isManager) return
    if (!quiet) setTeamLoading(true)
    const { data, error } = await supabase.rpc('team_month_performance', { p_month: month })
    if (error) console.error(error)
    setRows(data ?? [])
    setTeamLoading(false)
  }, [isManager, month])

  const loadSeries = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    const { data } = isManager
      ? await supabase.rpc('clinic_monthly_series')
      : await supabase.rpc('user_monthly_series', { p_user: profile?.id })
    setSeries(data ?? [])
    setLoading(false)
  }, [isManager, profile?.id])

  // الهدف الشهري قيمة واحدة في profiles — تخصّ الشهر الجاري فقط
  const loadTarget = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase.from('profiles')
      .select('monthly_target').eq('id', profile.id).maybeSingle()
    setTarget(Number(data?.monthly_target ?? 0))
  }, [profile?.id])

  // تحميل أوّلي
  useEffect(() => { loadTeam() }, [loadTeam])
  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadTarget() }, [loadTarget])

  // تحديث هادئ عند رجوع الصفحة للواجهة (focus / visibility) — بلا وميض تحميل
  const lastRefresh = useRef(0)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefresh.current < 1500) return   // تجنّب الإطلاق المزدوج focus+visibility
      lastRefresh.current = now
      loadTeam({ quiet: true }); loadSeries({ quiet: true }); loadTarget()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadTeam, loadSeries, loadTarget])

  // قائمة الشهور المتاحة — مع ضمان وجود الشهر الجاري (وموظف البلازما: آخر سنة)
  const months = useMemo(() => {
    const set = new Set(series.map(r => monthKey(r.month)))
    set.add(thisMonth())
    if (isPrp) lastMonths(12).forEach(m => set.add(m))
    return [...set].sort().reverse()
  }, [series, isPrp])

  // تفصيل المبيعات حسب النوع للشهر المختار (عمليات / جلسات علاج / منتجات)
  const [breakdown, setBreakdown] = useState(null)
  useEffect(() => {
    if (isPrp && !isManager) return
    let alive = true
    supabase.rpc('sales_breakdown', { p_month: month, p_user: isManager ? null : profile?.id ?? null })
      .then(({ data }) => { if (alive) setBreakdown(data ?? null) })
    return () => { alive = false }
  }, [month, isManager, isPrp, profile?.id])
  const other = ['treatment', 'product'].reduce((t, k) => ({
    count: t.count + Number(breakdown?.[k]?.count ?? 0),
    revenue: t.revenue + Number(breakdown?.[k]?.revenue ?? 0),
  }), { count: 0, revenue: 0 })
  const otherSplit = [['treatment', t('dashboard.treatments')], ['product', t('dashboard.products')]]
    .filter(([k]) => Number(breakdown?.[k]?.count ?? 0) > 0)
    .map(([k, l]) => `${fmt(breakdown[k].count)} ${l}`).join(' · ')

  // أرقام البلازما للشهر المختار: المدير للعيادة كلها، وموظف البلازما لنفسه
  const showPrp = isManager || isPrp
  const { stats: prpStats, loading: prpLoading } =
    usePrpMonthStats(showPrp ? month : null, isPrp && !isManager ? profile?.id ?? null : null)

  const byMonth = useMemo(
    () => Object.fromEntries(series.map(r => [monthKey(r.month), r])),
    [series]
  )

  const cur = byMonth[month]
  const prevKey = months[months.indexOf(month) + 1]
  const prev = prevKey ? byMonth[prevKey] : null

  const isCurrentMonth = month === thisMonth()

  // key = مفتاح الكارت (dashboard.cards.*) — ومنه نعرف أي رقم نقارنه بالشهر السابق
  const SAR = curSym()
  const cards = isManager
    ? [
        { key: 'operations', value: fmt(cur?.deals_count), now: cur?.deals_count, before: prev?.deals_count },
        { key: 'revenue', value: fmt(cur?.revenue) + ' ' + SAR, gold: true, now: cur?.revenue, before: prev?.revenue },
        { key: 'collected', value: fmt(cur?.collected) + ' ' + SAR, now: cur?.collected, before: prev?.collected },
        { key: 'leadsIn', value: fmt(cur?.leads_count), now: cur?.leads_count, before: prev?.leads_count },
        ...(other.count > 0 ? [{ key: 'sessionsProducts', value: fmt(other.count), other: true }] : []),
      ]
    : [
        { key: 'myOperations', value: fmt(cur?.deals_count), now: cur?.deals_count, before: prev?.deals_count },
        { key: 'myRevenue', value: fmt(cur?.revenue) + ' ' + SAR, gold: true, now: cur?.revenue, before: prev?.revenue },
        { key: 'myCollected', value: fmt(cur?.collected) + ' ' + SAR, now: cur?.collected, before: prev?.collected },
        { key: 'myLeadsIn', value: fmt(cur?.leads_received), now: cur?.leads_received, before: prev?.leads_received },
        ...(other.count > 0 ? [{ key: 'sessionsProducts', value: fmt(other.count), other: true }] : []),
      ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <div className="hint">
            {isCurrentMonth
              ? t('dashboard.subCurrent')
              : t('dashboard.subMonth', { month: monthLabel(month) })}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => (
              <option key={m} value={m}>
                {monthLabel(m)}{m === thisMonth() ? ` (${t('common.current')})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : (
        <>
          {isPrp && !isManager && (
            <>
              <PrpMonthStats stats={prpStats} loading={prpLoading} personal />
              <div className="hint" style={{ marginTop: -6 }}>
                {t('dashboard.prpMineHint', { month: monthLabel(month) })}
              </div>
            </>
          )}

          {!(isPrp && !isManager) && (
          <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {cards.map(c => (
              <div key={c.key} className={'card kpi-card' + (c.other ? ' kpi-wide' : '')} style={{ padding: 20 }}>
                <div className="kpi-label" style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 6 }}>{t(`dashboard.cards.${c.key}`)}</div>
                <div className="kpi-value" style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
                  color: c.gold ? 'var(--gold)' : 'var(--ink)',
                }}>{c.value}</div>
                {c.other ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
                    {otherSplit} · {fmt(other.revenue)} {SAR}
                    <div style={{ fontSize: 11.5 }}>{t('dashboard.otherHint')}</div>
                  </div>
                ) : (
                <div className="kpi-delta" style={{ marginTop: 6, minHeight: 18 }}>
                  <Delta now={c.now} before={c.before} />
                </div>
                )}
              </div>
            ))}
          </div>
          )}

          {/* الهدف الشهري — للشهر الجاري فقط، لأن القيمة واحدة لا تاريخية */}
          {!isManager && isCurrentMonth && (
            <div className="card kpi-target" style={{ padding: 20, marginTop: 16 }}>
              {target > 0 ? (() => {
                const done = Number(cur?.revenue ?? 0)
                const pct = Math.min(100, Math.round((done / target) * 100))
                const left = Math.max(0, target - done)
                const reached = done >= target
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('dashboard.myTarget')}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: reached ? 'var(--ok)' : 'var(--ink-soft)' }}>
                        {reached ? t('dashboard.targetReached') : t('dashboard.targetLeft', { amount: fmt(left), cur: SAR })}
                      </div>
                    </div>

                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
                      color: 'var(--ink)', margin: '6px 0 12px',
                    }}>
                      {fmt(done)} <span style={{ fontSize: 16, color: 'var(--ink-soft)' }}>{t('dashboard.ofTarget', { amount: fmt(target), cur: SAR })}</span>
                    </div>

                    <div style={{
                      height: 12, borderRadius: 999, background: 'var(--line)', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: pct + '%', height: '100%', borderRadius: 999,
                        background: reached ? 'var(--ok)' : 'var(--gold)',
                        transition: 'width .4s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>
                      {t('dashboard.pctOfTarget', { pct })}
                    </div>
                  </>
                )
              })() : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>{t('dashboard.myTarget')}</div>
                  <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>
                    {t('dashboard.noTarget')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                    {t('dashboard.noTargetHint')}
                  </div>
                </>
              )}
            </div>
          )}

          {!cur && !isPrp && (
            <div className="card empty" style={{ marginTop: 16 }}>
              <strong>{t('dashboard.noNumbersIn', { month: monthLabel(month) })}</strong>
              {t('dashboard.noNumbersBody')}
            </div>
          )}

          {/* سجل الشهور */}
          {series.length > 1 && !(isPrp && !isManager) && (
            <div className="card" style={{ marginTop: 24 }}>
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>{t('dashboard.monthsLog')}</h2>
              </div>
              <div className="table-scroll" style={{ marginTop: 10, maxHeight: 300 }}>
              <table className="table sticky-head dash-table">
                <thead>
                  <tr>
                    <th>{t('common.month')}</th><th>{t('common.operations')}</th><th>{t('common.revenue')}</th>
                    <th>{t('common.collected')}</th><th>{t('common.leads')}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map(r => {
                    const k = monthKey(r.month)
                    return (
                      <tr key={k}
                        onClick={() => setMonth(k)}
                        style={{
                          cursor: 'pointer',
                          fontWeight: k === month ? 700 : 400,
                          background: k === month ? 'var(--surface)' : undefined,
                        }}>
                        <td>{monthLabel(r.month)}{k === thisMonth() ? ` (${t('common.current')})` : ''}</td>
                        <td>{fmt(r.deals_count)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(r.revenue)} {SAR}</td>
                        <td>{fmt(r.collected)} {SAR}</td>
                        <td>{fmt(r.leads_count ?? r.leads_received)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* أداء الفريق — للشهر المختار */}
          {isManager && (rows.length > 0 || teamLoading) && (
            <div className="card" style={{ marginTop: 24, opacity: teamLoading ? 0.6 : 1, transition: 'opacity .15s' }}>
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>
                  {isCurrentMonth ? t('dashboard.teamThisMonth') : t('dashboard.teamInMonth', { month: monthLabel(month) })}
                </h2>
                <div className="hint" style={{ marginTop: 4 }}>
                  {t('dashboard.teamHint')}
                </div>
              </div>
              {(() => {
                const isAll = teamTab === 'all'
                const list = rows
                  .filter(r => isAll
                    // الكل: السيلز والمنسقات دايمًا، وأي وظيفة تانية لو ليها أرقام
                    ? (tabOf(r.role_code) !== 'other' || hasNumbers(r))
                    // السيلز: + المديرين اللي ليهم أرقام (مريض معرفة جابه المدير مثلًا)
                    : teamTab === 'sales'
                      ? (tabOf(r.role_code) === 'sales'
                         || (['sales_manager', 'super_admin'].includes(r.role_code) && hasNumbers(r)))
                      : tabOf(r.role_code) === teamTab)
                  .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                const sum = (k) => list.reduce((t, r) => t + Number(r[k] ?? 0), 0)
                const hasOther = rows.some(r => Number(r.other_count ?? 0) > 0)   // عمود الجلسات/المنتجات لو فيه
                return (
                  <>
                    <div className="tabs" style={{ margin: '12px 16px 0' }}>
                      {TEAM_TABS.map(k => (
                        <button key={k} type="button"
                          className={'tab' + (teamTab === k ? ' on' : '')}
                          onClick={() => setTeamTab(k)}>
                          {t(`dashboard.tabs.${k}`)}
                        </button>
                      ))}
                    </div>
                    {!list.length ? (
                      <div className="hint" style={{ padding: 16 }}>{t('dashboard.noNumbersMonth')}</div>
                    ) : (
                      <div className="table-scroll" style={{ marginTop: 8 }}>
                      <table className="table sticky-head dash-table">
                        <thead>
                          <tr>
                            <th>{t('common.employee')}</th>
                            {isAll && <th>{t('common.role')}</th>}
                            <th>{t('common.operations')}</th>{hasOther && <th>{t('dashboard.sessionsProductsCol')}</th>}<th>{t('common.revenue')}</th><th>{t('common.collected')}</th><th>{t('common.leads')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map(r => (
                            <tr key={r.user_id}>
                              <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                              {isAll && (
                                <td style={{ color: 'var(--ink-soft)' }}>
                                  {r.role_code ? t(`rolesShort.${r.role_code}`, { defaultValue: r.role_code }) : '—'}
                                </td>
                              )}
                              <td>{fmt(r.deals_count)}</td>
                              {hasOther && <td>{fmt(r.other_count)}</td>}
                              <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(r.revenue)} {SAR}</td>
                              <td>{fmt(r.collected)} {SAR}</td>
                              <td>{fmt(r.leads_received)}</td>
                            </tr>
                          ))}
                          {/* الإجمالي في تاب الوظيفة بس — في "الكل" هيبقى مكرر (العملية للسيلز والمنسقة) */}
                          {!isAll && list.length > 1 && (
                            <tr style={{ fontWeight: 700, background: 'var(--line-soft)' }}>
                              <td>{t('common.total')}</td>
                              <td>{fmt(sum('deals_count'))}</td>
                              {hasOther && <td>{fmt(sum('other_count'))}</td>}
                              <td style={{ color: 'var(--gold)' }}>{fmt(sum('revenue'))} {SAR}</td>
                              <td>{fmt(sum('collected'))} {SAR}</td>
                              <td>{fmt(sum('leads_received'))}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </>
                )
              })()}
              <div style={{ height: 8 }} />
            </div>
          )}

          {/* البلازما — للشهر المختار */}
          {isManager && (
            <div className="card" style={{ marginTop: 24, padding: 16 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>
                {isCurrentMonth ? t('dashboard.prpThisMonth') : t('dashboard.prpInMonth', { month: monthLabel(month) })}
              </h2>
              <PrpMonthStats stats={prpStats} loading={prpLoading} />
              {(prpStats?.by_performer ?? []).length > 0 && (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>{t('common.employee')}</th><th>{t('dashboard.sessionsDone')}</th></tr></thead>
                    <tbody>
                      {prpStats.by_performer.map(p => (
                        <tr key={p.user_id}>
                          <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                          <td>{fmt(p.n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
