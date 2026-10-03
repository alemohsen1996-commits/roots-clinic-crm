// التقارير (للمديرين) — فترة زمنية + قمع + ترتيب الفريق + تفصيلات + تصدير CSV
// الحسابات كلها في القاعدة (report_summary) — نداء واحد مهما كانت الفترة
// التواريخ بتوقيت السعودية · ترتيب الفريق بتابات (الكل / السيلز / المنسقات)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import Funnel from './Funnel'
import Breakdowns from './Breakdowns'
import useT from '../i18n/useT'
import { kindLabel } from '../deals/useDealRefs'

// التواريخ بتوقيت السعودية — toISOString كان بيحوّل لجرينتش فيرجّع 3 ساعات
// ("الشهر الجاري" كان بيبدأ من آخر يوم في الشهر اللي فات)
const TZ = '+03:00'
const riyadhDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d)   // YYYY-MM-DD
const monthStart = () => riyadhDate().slice(0, 8) + '01'
const today = () => riyadhDate()

// تابات ترتيب الفريق — نفس فكرة لوحة التحكم
const TEAM_TABS = ['all', 'agent', 'coordinator']   // العناوين من dashboard.tabs.* (agent = sales)

// فلتر نوع البيع — من غير فلتر: "العمليات" = جراحية بس والإيراد = كل المبيعات
const KINDS = ['', 'surgery', 'treatment', 'product']

export default function ReportsPage() {
  const { t } = useT()
  const SAR = t('common.currency')
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
      setErr(t('reports.fromAfterTo')); setLoading(false)
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
      setErr(t('reports.loadFailed') + ' — ' + (error?.message || ''))
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
    const i18nRole = (code) => t(`rolesShort.${code}`, { defaultValue: code })
    setTeam((r.team ?? []).map(tm => {
      const leads = Number(tm.leads ?? 0), deals = Number(tm.deals ?? 0)
      return {
        name: tm.name ?? '—',
        role: tm.role ? i18nRole(tm.role) : '—',
        roleCode: tm.role ?? null,
        inactive: tm.status && tm.status !== 'active',
        leads, deals,
        other: Number(tm.other ?? 0),
        revenue: Number(tm.revenue ?? 0),
        ratio: leads ? Math.round((deals / leads) * 100) : null,
      }
    }))
    setLoading(false)
  }, [from, to, kind, t])

  useEffect(() => { load() }, [load])

  // نسبتان مختلفتان — لا يجوز الخلط بينهما
  const periodRatio = totals.leads ? Math.round((totals.deals / totals.leads) * 100) : 0
  const cohortRate = totals.leads ? Math.round((totals.cohortDeals / totals.leads) * 100) : 0

  const funnelCounts = funnelMode === 'current' ? stageCounts : reachedCounts

  // كلمة العدّ حسب الفلتر، وعمود جلسات/منتجات بس من غير فلتر ولو فيه مبيعات منهم
  const dealsWord = kind ? kindLabel(kind) : t('kind.surgery')
  const showOther = !kind && totals.otherSales > 0
  const kindRows = ['surgery', 'treatment', 'product']
    .map(k => ({ k, count: Number(byKind[k]?.count ?? 0), revenue: Number(byKind[k]?.revenue ?? 0) }))
    .filter(x => x.count > 0)
  const kindTotal = kindRows.reduce((acc, x) => acc + x.revenue, 0)

  function doExport() {
    exportCsv(
      `report-${from}-to-${to}.csv`,
      [t('common.employee'), t('common.role'), t('common.leads'), dealsWord, ...(showOther ? [t('dashboard.sessionsProductsCol')] : []), t('common.revenue'), t('reports.opsPerLeads') + ' %'],
      team.map(tm => [tm.name, tm.role, tm.leads, tm.deals, ...(showOther ? [tm.other] : []), tm.revenue, tm.ratio ?? ''])
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.reports')}</h1>
          <div className="hint">{t('drawer.from')} {from} {t('drawer.to')} {to}</div>
        </div>
        <button className="btn btn-ghost" onClick={doExport} disabled={loading}>
          {t('reports.exportCsv')}
        </button>
      </div>

      <div className="card filters-bar">
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('drawer.from')}</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('leads.f.to')}</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => { setFrom(monthStart()); setTo(today()) }}>
          {t('reports.currentMonth')}
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />
        {KINDS.map(k => (
          <button key={k || 'all'} type="button" aria-pressed={kind === k}
            className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
            {k ? kindLabel(k) : t('deals.allSales')}
          </button>
        ))}
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? (
        <div className="empty">
          {t('common.loading')}
        </div>
      ) : (
        <>
          {/* بطاقات الإجماليات */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
            {[
              { label: t('reports.periodLeads'), value: fmtNum(totals.leads) },
              { label: t('reports.doneInPeriod', { what: dealsWord }), value: fmtNum(totals.deals),
                hint: showOther ? t('reports.otherSalesHint', { n: fmtNum(totals.otherSales) }) : undefined },
              {
                label: t('reports.cohortConversion'),
                value: cohortRate + '%',
                hint: t('reports.cohortHint', { n: fmtNum(totals.cohortDeals) }),
              },
              {
                label: t('reports.opsPerLeads'),
                value: periodRatio + '%',
                hint: t('reports.ratioHint'),
              },
              { label: kind ? t('reports.kindRevenue', { kind: kindLabel(kind) }) : t('reports.contractedRevenue'), value: fmtNum(totals.revenue) + ' ' + SAR, gold: true },
              { label: t('dashboard.cards.collected'), value: fmtNum(totals.collected) + ' ' + SAR, gold: true },
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
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>{t('reports.revenueByKind')}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {kindRows.map(x => {
                  const pct = kindTotal ? Math.round((x.revenue / kindTotal) * 100) : 0
                  return (
                    <div key={x.k}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>{kindLabel(x.k)} · {fmtNum(x.count)}</span>
                        <span>{fmtNum(x.revenue)} {SAR} ({pct}%)</span>
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
                  onClick={() => setFunnelMode('current')}>{t('reports.funnelCurrent')}</button>
                <button className={'tab' + (funnelMode === 'reached' ? ' on' : '')}
                  onClick={() => setFunnelMode('reached')}>{t('reports.funnelReached')}</button>
              </div>
              <Funnel
                stages={stages}
                counts={funnelCounts}
                subtitle={funnelMode === 'current'
                  ? t('reports.funnelCurrentSub')
                  : t('reports.funnelReachedSub')}
              />
            </div>

            {/* ترتيب الفريق */}
            <div className="card">
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>{t('reports.leaderboard')}</h2>
                <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.6 }}>
                  {t('reports.leaderboardHint')}
                </p>
              </div>
              {(() => {
                const isAll = teamTab === 'all'
                const list = isAll ? team : team.filter(tm => tm.roleCode === teamTab)
                const sum = (k) => list.reduce((a, tm) => a + Number(tm[k] ?? 0), 0)
                return (
                  <>
                    <div className="tabs" style={{ margin: '12px 16px 0' }}>
                      {TEAM_TABS.map(k => (
                        <button key={k} type="button"
                          className={'tab' + (teamTab === k ? ' on' : '')}
                          onClick={() => setTeamTab(k)}>{t(`dashboard.tabs.${k === 'agent' ? 'sales' : k}`)}</button>
                      ))}
                    </div>
                    {list.length === 0 ? <div className="empty">{t('reports.noDataPeriod')}</div> : (
                      <div style={{ overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>#</th><th>{t('common.employee')}</th>{isAll && <th>{t('common.role')}</th>}
                            <th>{t('common.leads')}</th><th>{dealsWord}</th>{showOther && <th>{t('dashboard.sessionsProductsCol')}</th>}<th>{t('common.revenue')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((tm, i) => (
                            <tr key={tm.name + i} style={{ opacity: tm.inactive ? .55 : 1 }}>
                              <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                              <td style={{ fontWeight: 600 }}>
                                {tm.name}
                                {tm.inactive && (
                                  <small style={{ color: 'var(--ink-soft)' }}> ({t('reports.suspended')})</small>
                                )}
                              </td>
                              {isAll && <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{tm.role}</td>}
                              <td>{fmtNum(tm.leads)}</td>
                              <td>{fmtNum(tm.deals)}</td>
                              {showOther && <td>{fmtNum(tm.other)}</td>}
                              <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(tm.revenue)}</td>
                            </tr>
                          ))}
                          {/* الإجمالي في تاب الوظيفة بس — في "الكل" هيبقى مكرر */}
                          {!isAll && list.length > 1 && (
                            <tr style={{ fontWeight: 700, background: 'var(--line-soft)' }}>
                              <td></td><td>{t('common.total')}</td>
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
