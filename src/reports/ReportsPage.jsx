// التقارير (للمديرين) — فترة زمنية + قمع + ترتيب الفريق + تفصيلات + تصدير CSV
// الحسابات كلها في القاعدة (report_summary) — نداء واحد مهما كانت الفترة
// التواريخ بتوقيت السعودية · ترتيب الفريق بتابات (الكل / السيلز / المنسقات)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import Funnel from './Funnel'
import Breakdowns from './Breakdowns'

// التواريخ بتوقيت السعودية — toISOString كان بيحوّل لجرينتش فيرجّع 3 ساعات
// ("الشهر الجاري" كان بيبدأ من آخر يوم في الشهر اللي فات)
const TZ = '+03:00'
const riyadhDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d)   // YYYY-MM-DD
const monthStart = () => riyadhDate().slice(0, 8) + '01'
const today = () => riyadhDate()

// تابات ترتيب الفريق — نفس فكرة لوحة التحكم
const TEAM_TABS = [
  { key: 'all',         title: 'الكل' },
  { key: 'agent',       title: 'السيلز' },
  { key: 'coordinator', title: 'المنسقات' },
]

// فلتر نوع البيع — من غير فلتر: "العمليات" = جراحية بس والإيراد = كل المبيعات
const KINDS = [
  { id: '', label: 'كل المبيعات' },
  { id: 'surgery', label: 'عمليات' },
  { id: 'treatment', label: 'جلسات علاج' },
  { id: 'product', label: 'منتجات' },
]
const KIND_NAME = { surgery: 'عمليات', treatment: 'جلسات علاج', product: 'منتجات' }

const ROLE_AR = {
  agent: 'مبيعات', coordinator: 'منسقة', sales_manager: 'مدير مبيعات',
  super_admin: 'مدير عام', accountant: 'محاسب', prp_officer: 'بلازما',
}

export default function ReportsPage() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [stages, setStages] = useState([])
  const [stageCounts, setStageCounts] = useState({})
  const [reachedCounts, setReachedCounts] = useState({})
  const [funnelMode, setFunnelMode] = useState('current')  // current | reached
  const [bySource, setBySource] = useState([])
  const [byLost, setByLost] = useState([])
  const [team, setTeam] = useState([])
  const [teamTab, setTeamTab] = useState('all')
  const [kind, setKind] = useState('')
  const [byKind, setByKind] = useState({})
  const [totals, setTotals] = useState({
    leads: 0, deals: 0, revenue: 0, collected: 0, cohortDeals: 0, otherSales: 0,
  })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // كل الحسابات في القاعدة (report_summary) — نداء واحد بدل ما نجيب كل الليدات للمتصفح
  const load = useCallback(async () => {
    if (from > to) {
      setErr('تاريخ البداية بعد تاريخ النهاية'); setLoading(false)
      return
    }
    setLoading(true); setErr('')
    // حدود اليوم بتوقيت السعودية
    const fromTs = from + 'T00:00:00' + TZ
    const toTs = to + 'T23:59:59.999' + TZ

    const [{ data: st }, { data: r, error }] = await Promise.all([
      supabase.from('stages').select('*').eq('is_active', true).order('sort_order'),
      supabase.rpc('report_summary', { p_from: fromTs, p_to: toTs, p_kind: kind || null }),
    ])
    if (error || !r) {
      setErr('تعذر تحميل التقرير — ' + (error?.message || ''))
      setLoading(false)
      return
    }

    setStages(st ?? [])
    setStageCounts(r.stage_counts ?? {})
    setReachedCounts(r.reached_counts ?? {})
    setBySource(r.by_source ?? [])
    setByLost(r.by_lost ?? [])
    setTotals({
      leads: Number(r.leads ?? 0),
      deals: Number(r.deals ?? 0),
      revenue: Number(r.revenue ?? 0),
      collected: Number(r.collected ?? 0),
      cohortDeals: Number(r.cohort_deals ?? 0),
      otherSales: Number(r.other_sales ?? 0),
    })
    setByKind(r.by_kind ?? {})
    setTeam((r.team ?? []).map(t => {
      const leads = Number(t.leads ?? 0), deals = Number(t.deals ?? 0)
      return {
        name: t.name ?? '—',
        role: ROLE_AR[t.role] ?? '—',
        roleCode: t.role ?? null,
        inactive: t.status && t.status !== 'active',
        leads, deals,
        other: Number(t.other ?? 0),
        revenue: Number(t.revenue ?? 0),
        ratio: leads ? Math.round((deals / leads) * 100) : null,
      }
    }))
    setLoading(false)
  }, [from, to, kind])

  useEffect(() => { load() }, [load])

  // نسبتان مختلفتان — لا يجوز الخلط بينهما
  const periodRatio = totals.leads ? Math.round((totals.deals / totals.leads) * 100) : 0
  const cohortRate = totals.leads ? Math.round((totals.cohortDeals / totals.leads) * 100) : 0

  const funnelCounts = funnelMode === 'current' ? stageCounts : reachedCounts

  // كلمة العدّ حسب الفلتر، وعمود جلسات/منتجات بس من غير فلتر ولو فيه مبيعات منهم
  const dealsWord = kind ? KIND_NAME[kind] : 'عمليات'
  const showOther = !kind && totals.otherSales > 0
  const kindRows = ['surgery', 'treatment', 'product']
    .map(k => ({ k, count: Number(byKind[k]?.count ?? 0), revenue: Number(byKind[k]?.revenue ?? 0) }))
    .filter(x => x.count > 0)
  const kindTotal = kindRows.reduce((t, x) => t + x.revenue, 0)

  function doExport() {
    exportCsv(
      `report-${from}-to-${to}.csv`,
      ['الموظف', 'الدور', 'الليدات', dealsWord, ...(showOther ? ['جلسات/منتجات'] : []), 'الإيراد', 'عمليات/ليدات %'],
      team.map(t => [t.name, t.role, t.leads, t.deals, ...(showOther ? [t.other] : []), t.revenue, t.ratio ?? ''])
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>التقارير</h1>
          <div className="hint">من {from} إلى {to}</div>
        </div>
        <button className="btn btn-ghost" onClick={doExport} disabled={loading}>
          تصدير Excel (CSV)
        </button>
      </div>

      <div className="card filters-bar">
        <label style={{ fontSize: 13, fontWeight: 600 }}>من</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>إلى</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => { setFrom(monthStart()); setTo(today()) }}>
          الشهر الجاري
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />
        {KINDS.map(k => (
          <button key={k.id || 'all'} type="button" aria-pressed={kind === k.id}
            className={'chip' + (kind === k.id ? ' on' : '')} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? (
        <div className="empty">
          جارٍ التحميل…
        </div>
      ) : (
        <>
          {/* بطاقات الإجماليات */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
            {[
              { label: 'ليدات الفترة', value: fmtNum(totals.leads) },
              { label: `${dealsWord} تمت في الفترة`, value: fmtNum(totals.deals),
                hint: showOther ? `+ ${fmtNum(totals.otherSales)} جلسات/منتجات (داخلين في الإيراد)` : undefined },
              {
                label: 'تحويل ليدات الفترة',
                value: cohortRate + '٪',
                hint: `${fmtNum(totals.cohortDeals)} من ليدات هذه الفترة وصلوا لعملية`,
              },
              {
                label: 'عمليات ÷ ليدات',
                value: periodRatio + '٪',
                hint: 'نسبة إنتاجية — العمليات قد تعود لليدات أقدم',
              },
              { label: kind ? `إيراد ال${KIND_NAME[kind]}` : 'الإيراد (متعاقد)', value: fmtNum(totals.revenue) + ' ر.س', gold: true },
              { label: 'المحصّل فعليًا', value: fmtNum(totals.collected) + ' ر.س', gold: true },
            ].map(c => (
              <div key={c.label} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.label}</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
                  color: c.gold ? 'var(--gold)' : 'var(--ink)',
                }}>
                  {c.value}
                </div>
                {c.hint && (
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.6 }}>
                    {c.hint}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* الإيراد حسب نوع البيع */}
          {kindRows.length > 1 && (
            <div className="card" style={{ padding: 16, marginBottom: 18 }}>
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>الإيراد حسب نوع البيع</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {kindRows.map(x => {
                  const pct = kindTotal ? Math.round((x.revenue / kindTotal) * 100) : 0
                  return (
                    <div key={x.k}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>{KIND_NAME[x.k]} · {fmtNum(x.count)}</span>
                        <span>{fmtNum(x.revenue)} ر.س ({pct}٪)</span>
                      </div>
                      <div className="deals-bar"><span className="full" style={{ width: pct + '%' }} /></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 18 }}>
            <div>
              <div className="tabs" style={{ marginBottom: 10 }}>
                <button className={'tab' + (funnelMode === 'current' ? ' on' : '')}
                  onClick={() => setFunnelMode('current')}>وضعهم الآن</button>
                <button className={'tab' + (funnelMode === 'reached' ? ' on' : '')}
                  onClick={() => setFunnelMode('reached')}>مرّوا بالمرحلة</button>
              </div>
              <Funnel
                stages={stages}
                counts={funnelCounts}
                subtitle={funnelMode === 'current'
                  ? 'توزيع ليدات الفترة على مراحلها الحالية'
                  : 'كم ليد دخل كل مرحلة خلال الفترة — حتى لو غادرها بعدها'}
              />
            </div>

            {/* ترتيب الفريق */}
            <div className="card">
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>ترتيب الفريق (Leaderboard)</h2>
                <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.6 }}>
                  العملية الواحدة تُنسب للسيلز والمنسقة معًا لحساب العمولة —
                  لذلك مجموع الصفوف أكبر من إجمالي العيادة
                </p>
              </div>
              {(() => {
                const isAll = teamTab === 'all'
                const list = isAll ? team : team.filter(t => t.roleCode === teamTab)
                const sum = (k) => list.reduce((a, t) => a + Number(t[k] ?? 0), 0)
                return (
                  <>
                    <div className="tabs" style={{ margin: '12px 16px 0' }}>
                      {TEAM_TABS.map(t => (
                        <button key={t.key} type="button"
                          className={'tab' + (teamTab === t.key ? ' on' : '')}
                          onClick={() => setTeamTab(t.key)}>{t.title}</button>
                      ))}
                    </div>
                    {list.length === 0 ? <div className="empty">لا بيانات في الفترة</div> : (
                      <div style={{ overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>#</th><th>الموظف</th>{isAll && <th>الدور</th>}
                            <th>ليدات</th><th>{dealsWord}</th>{showOther && <th>جلسات/منتجات</th>}<th>الإيراد</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((t, i) => (
                            <tr key={t.name + i} style={{ opacity: t.inactive ? .55 : 1 }}>
                              <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                              <td style={{ fontWeight: 600 }}>
                                {t.name}
                                {t.inactive && (
                                  <small style={{ color: 'var(--ink-soft)' }}> (موقوف)</small>
                                )}
                              </td>
                              {isAll && <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t.role}</td>}
                              <td>{fmtNum(t.leads)}</td>
                              <td>{fmtNum(t.deals)}</td>
                              {showOther && <td>{fmtNum(t.other)}</td>}
                              <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(t.revenue)}</td>
                            </tr>
                          ))}
                          {/* الإجمالي في تاب الوظيفة بس — في "الكل" هيبقى مكرر */}
                          {!isAll && list.length > 1 && (
                            <tr style={{ fontWeight: 700, background: 'var(--line-soft)' }}>
                              <td></td><td>الإجمالي</td>
                              <td>{fmtNum(sum('leads'))}</td>
                              <td>{fmtNum(sum('deals'))}</td>
                              {showOther && <td>{fmtNum(sum('other'))}</td>}
                              <td style={{ color: 'var(--gold)' }}>{fmtNum(sum('revenue'))}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>

          <Breakdowns bySource={bySource} byLostReason={byLost} />
        </>
      )}
    </>
  )
}
