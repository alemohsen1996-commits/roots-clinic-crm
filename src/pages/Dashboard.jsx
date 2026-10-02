// لوحة التحكم — أرقام أي شهر (للموظف وللمدير)
// تُحسب من الديلات والدفعات مباشرة، فتعمل لأي شهر مضى
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtMonth } from '../lib/format'
import PrpMonthStats, { usePrpMonthStats, lastMonths } from '../prp/PrpMonthStats'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US')

const monthKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}
const thisMonth = () => monthKey(new Date())

const monthLabel = (m) => fmtMonth(m)

// تابات جدول أداء الفريق
const TEAM_TABS = [
  { key: 'all',         title: 'الكل' },
  { key: 'sales',       title: 'السيلز' },
  { key: 'coordinator', title: 'المنسقات' },
]
const ROLE_TITLE = {
  agent: 'سيلز', coordinator: 'منسقة', super_admin: 'مدير',
  sales_manager: 'مدير مبيعات', accountant: 'محاسب',
}
const tabOf = (code) =>
  code === 'agent' ? 'sales' : code === 'coordinator' ? 'coordinator' : 'other'
const hasNumbers = (r) =>
  ['deals_count', 'revenue', 'collected', 'leads_received'].some(k => Number(r[k] ?? 0) > 0)

// سهم التغيّر مقارنة بالشهر السابق
function Delta({ now, before }) {
  if (before === undefined || before === null) return null
  const b = Number(before), n = Number(now)
  if (!b) return null
  const pct = Math.round(((n - b) / b) * 100)
  if (pct === 0) {
    return <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>= مثل الشهر السابق</span>
  }
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: pct > 0 ? 'var(--ok)' : 'var(--danger)' }}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}٪ عن الشهر السابق
    </span>
  )
}

export default function Dashboard() {
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
  const otherSplit = [['treatment', 'جلسات علاج'], ['product', 'منتجات']]
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

  const cards = isManager
    ? [
        { label: 'العمليات', value: fmt(cur?.deals_count), before: prev?.deals_count },
        { label: 'الإيراد', value: fmt(cur?.revenue) + ' ر.س', gold: true, before: prev?.revenue },
        { label: 'المحصّل فعليًا', value: fmt(cur?.collected) + ' ر.س', before: prev?.collected },
        { label: 'الليدات الواردة', value: fmt(cur?.leads_count), before: prev?.leads_count },
        ...(other.count > 0 ? [{ label: 'جلسات ومنتجات', value: fmt(other.count), other: true }] : []),
      ]
    : [
        { label: 'عملياتي', value: fmt(cur?.deals_count), before: prev?.deals_count },
        { label: 'إيرادي', value: fmt(cur?.revenue) + ' ر.س', gold: true, before: prev?.revenue },
        { label: 'المحصّل من عملائي', value: fmt(cur?.collected) + ' ر.س', before: prev?.collected },
        { label: 'ليداتي الواردة', value: fmt(cur?.leads_received), before: prev?.leads_received },
        ...(other.count > 0 ? [{ label: 'جلسات ومنتجات', value: fmt(other.count), other: true }] : []),
      ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>لوحة التحكم</h1>
          <div className="hint">
            {isCurrentMonth
              ? 'أرقام الشهر الجاري — تتحدّث لحظيًا'
              : `أرقام ${monthLabel(month)} — مكتملة`}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => (
              <option key={m} value={m}>
                {monthLabel(m)}{m === thisMonth() ? ' (الجاري)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : (
        <>
          {isPrp && !isManager && (
            <>
              <PrpMonthStats stats={prpStats} loading={prpLoading} personal />
              <div className="hint" style={{ marginTop: -6 }}>
                الجلسات اللي سجّلتها بنفسك في {monthLabel(month)} — قوايم الشغل اليومية في قسم البلازما
              </div>
            </>
          )}

          {!(isPrp && !isManager) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {cards.map(c => (
              <div key={c.label} className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 6 }}>{c.label}</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
                  color: c.gold ? 'var(--gold)' : 'var(--ink)',
                }}>{c.value}</div>
                {c.other ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
                    {otherSplit} · {fmt(other.revenue)} ر.س
                    <div style={{ fontSize: 11.5 }}>داخلين في الإيراد · مش محسوبين عمليات</div>
                  </div>
                ) : (
                <div style={{ marginTop: 6, minHeight: 18 }}>
                  <Delta now={
                    c.label.includes('الإيراد') || c.label.includes('إيرادي') ? cur?.revenue
                    : c.label.includes('المحصّل') ? cur?.collected
                    : c.label.includes('الليدات') || c.label.includes('ليداتي')
                      ? (cur?.leads_count ?? cur?.leads_received)
                    : cur?.deals_count
                  } before={c.before} />
                </div>
                )}
              </div>
            ))}
          </div>
          )}

          {/* الهدف الشهري — للشهر الجاري فقط، لأن القيمة واحدة لا تاريخية */}
          {!isManager && isCurrentMonth && (
            <div className="card" style={{ padding: 20, marginTop: 16 }}>
              {target > 0 ? (() => {
                const done = Number(cur?.revenue ?? 0)
                const pct = Math.min(100, Math.round((done / target) * 100))
                const left = Math.max(0, target - done)
                const reached = done >= target
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>هدفي الشهري</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: reached ? 'var(--ok)' : 'var(--ink-soft)' }}>
                        {reached ? '🎉 تجاوزت هدفك' : `باقي ${fmt(left)} ر.س`}
                      </div>
                    </div>

                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
                      color: 'var(--ink)', margin: '6px 0 12px',
                    }}>
                      {fmt(done)} <span style={{ fontSize: 16, color: 'var(--ink-soft)' }}>من {fmt(target)} ر.س</span>
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
                      {pct}٪ من الهدف
                    </div>
                  </>
                )
              })() : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>هدفي الشهري</div>
                  <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>
                    لم يُحدَّد هدف لهذا الشهر بعد
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                    يضبطه المدير من صفحة الموظفين
                  </div>
                </>
              )}
            </div>
          )}

          {!cur && !isPrp && (
            <div className="card empty" style={{ marginTop: 16 }}>
              <strong>لا أرقام في {monthLabel(month)}</strong>
              لم تُسجَّل عمليات أو تحصيلات في هذا الشهر
            </div>
          )}

          {/* سجل الشهور */}
          {series.length > 1 && !(isPrp && !isManager) && (
            <div className="card" style={{ marginTop: 24 }}>
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>سجل الشهور</h2>
              </div>
              <div className="table-scroll" style={{ marginTop: 10, maxHeight: 300 }}>
              <table className="table sticky-head">
                <thead>
                  <tr>
                    <th>الشهر</th><th>العمليات</th><th>الإيراد</th>
                    <th>المحصّل</th><th>الليدات</th>
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
                        <td>{monthLabel(r.month)}{k === thisMonth() ? ' (الجاري)' : ''}</td>
                        <td>{fmt(r.deals_count)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(r.revenue)} ر.س</td>
                        <td>{fmt(r.collected)} ر.س</td>
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
                  {isCurrentMonth ? 'أداء الفريق هذا الشهر' : `أداء الفريق في ${monthLabel(month)}`}
                </h2>
                <div className="hint" style={{ marginTop: 4 }}>
                  العملية الواحدة تُنسب للسيلز والمنسقة معًا لحساب العمولة —
                  لذلك مجموع الصفوف أكبر من إجمالي العيادة بالأعلى
                </div>
              </div>
              {(() => {
                const isAll = teamTab === 'all'
                const list = rows
                  .filter(r => isAll
                    // الكل: السيلز والمنسقات دايمًا، وأي وظيفة تانية لو ليها أرقام
                    ? (tabOf(r.role_code) !== 'other' || hasNumbers(r))
                    : tabOf(r.role_code) === teamTab)
                  .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                const sum = (k) => list.reduce((t, r) => t + Number(r[k] ?? 0), 0)
                const hasOther = rows.some(r => Number(r.other_count ?? 0) > 0)   // عمود الجلسات/المنتجات لو فيه
                return (
                  <>
                    <div className="tabs" style={{ margin: '12px 16px 0' }}>
                      {TEAM_TABS.map(t => (
                        <button key={t.key} type="button"
                          className={'tab' + (teamTab === t.key ? ' on' : '')}
                          onClick={() => setTeamTab(t.key)}>
                          {t.title}
                        </button>
                      ))}
                    </div>
                    {!list.length ? (
                      <div className="hint" style={{ padding: 16 }}>لا توجد أرقام لهذا الشهر</div>
                    ) : (
                      <div className="table-scroll" style={{ marginTop: 8 }}>
                      <table className="table sticky-head">
                        <thead>
                          <tr>
                            <th>الموظف</th>
                            {isAll && <th>الوظيفة</th>}
                            <th>العمليات</th>{hasOther && <th>جلسات/منتجات</th>}<th>الإيراد</th><th>المحصّل</th><th>الليدات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map(r => (
                            <tr key={r.user_id}>
                              <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                              {isAll && (
                                <td style={{ color: 'var(--ink-soft)' }}>
                                  {ROLE_TITLE[r.role_code] ?? r.role_code ?? '—'}
                                </td>
                              )}
                              <td>{fmt(r.deals_count)}</td>
                              {hasOther && <td>{fmt(r.other_count)}</td>}
                              <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(r.revenue)} ر.س</td>
                              <td>{fmt(r.collected)} ر.س</td>
                              <td>{fmt(r.leads_received)}</td>
                            </tr>
                          ))}
                          {/* الإجمالي في تاب الوظيفة بس — في "الكل" هيبقى مكرر (العملية للسيلز والمنسقة) */}
                          {!isAll && list.length > 1 && (
                            <tr style={{ fontWeight: 700, background: 'var(--line-soft)' }}>
                              <td>الإجمالي</td>
                              <td>{fmt(sum('deals_count'))}</td>
                              {hasOther && <td>{fmt(sum('other_count'))}</td>}
                              <td style={{ color: 'var(--gold)' }}>{fmt(sum('revenue'))} ر.س</td>
                              <td>{fmt(sum('collected'))} ر.س</td>
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
                {isCurrentMonth ? 'البلازما هذا الشهر' : `البلازما في ${monthLabel(month)}`}
              </h2>
              <PrpMonthStats stats={prpStats} loading={prpLoading} />
              {(prpStats?.by_performer ?? []).length > 0 && (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>الموظف</th><th>جلسات عملها</th></tr></thead>
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
