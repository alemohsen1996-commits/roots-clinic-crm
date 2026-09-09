// التقارير (للمديرين) — فترة زمنية + قمع + ترتيب الفريق + تفصيلات + تصدير CSV
// إصلاحات: استبعاد الدفعات الملغاة · إزالة سقف 5000 · إدراج المنسقات ·
//          فصل معدل التحويل الحقيقي · قمع بوضعين · أسماء من profiles
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import Funnel from './Funnel'
import Breakdowns from './Breakdowns'

const BATCH = 1000
const CAP = 100000   // حاجز أمان

const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString().slice(0, 10)
const today = () => new Date().toISOString().slice(0, 10)

// جلب كل الصفوف على دفعات — بديل limit(5000) الذي كان يقطع البيانات بصمت
async function fetchAll(build, onProgress) {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await build(offset, offset + BATCH - 1)
    if (error) throw error
    const batch = data ?? []
    out.push(...batch)
    onProgress?.(out.length)
    if (batch.length < BATCH) break
    offset += BATCH
    if (offset >= CAP) return { rows: out, truncated: true }
  }
  return { rows: out, truncated: false }
}

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
  const [totals, setTotals] = useState({
    leads: 0, deals: 0, revenue: 0, collected: 0, cohortDeals: 0,
  })
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [warn, setWarn] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setWarn(''); setProgress(0)
    const fromTs = from + 'T00:00:00'
    const toTs = to + 'T23:59:59'

    try {
      // ---------- المراجع ----------
      const [{ data: st }, { data: sources }, { data: reasons }, { data: people }] =
        await Promise.all([
          supabase.from('stages').select('*').eq('is_active', true).order('sort_order'),
          supabase.from('lead_sources').select('id, name_ar'),
          supabase.from('lost_reasons').select('id, name_ar'),
          // كل الموظفين — لا النشطين فقط، حتى لا تختفي أسماء من غادروا
          supabase.from('profiles').select('id, full_name, status, roles(code)'),
        ])
      setStages(st ?? [])

      // ---------- الليدات (كل الفترة، بلا سقف) ----------
      const leadsRes = await fetchAll(
        (a, b) => supabase.from('leads')
          .select('id, stage_id, source_id, lost_reason_id, owner_id, created_at')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at', { ascending: true })
          .range(a, b),
        setProgress
      )
      const leads = leadsRes.rows
      if (leadsRes.truncated) {
        setWarn(`الفترة تحتوي أكثر من ${CAP.toLocaleString('ar-EG')} ليد — التقرير يعرض جزءًا منها فقط. قلّص الفترة لنتيجة دقيقة.`)
      }

      // ---------- الديلات المنتهية في الفترة ----------
      const dealsRes = await fetchAll((a, b) => supabase.from('deals')
        .select('id, net_amount, agent_id, coordinator_id, outcome_at, lead_id')
        .eq('status', 'done')
        .gte('outcome_at', fromTs).lte('outcome_at', toTs)
        .order('outcome_at', { ascending: true })
        .range(a, b))
      const deals = dealsRes.rows

      // ---------- الدفعات النشطة فقط (كانت تشمل الملغاة) ----------
      const paysRes = await fetchAll((a, b) => supabase.from('payments')
        .select('amount, paid_at')
        .eq('status', 'active')
        .gte('paid_at', fromTs).lte('paid_at', toTs)
        .order('paid_at', { ascending: true })
        .range(a, b))
      const pays = paysRes.rows

      // ---------- تحويل الفوج: ليدات الفترة التي وصلت لعملية ----------
      const cohortRes = await fetchAll((a, b) => supabase.from('deals')
        .select('id, lead_id, leads!inner(created_at)')
        .eq('status', 'done')
        .gte('leads.created_at', fromTs).lte('leads.created_at', toTs)
        .range(a, b))
      const cohortLeadIds = new Set(cohortRes.rows.map(d => d.lead_id))

      // ---------- القمع: التوزيع الحالي ----------
      const sc = {}
      for (const l of leads) sc[l.stage_id] = (sc[l.stage_id] ?? 0) + 1
      setStageCounts(sc)

      // ---------- القمع: من مرّ فعلًا بكل مرحلة ----------
      const actsRes = await fetchAll((a, b) => supabase.from('activities')
        .select('lead_id, to_stage')
        .eq('type', 'stage_change')
        .gte('created_at', fromTs).lte('created_at', toTs)
        .not('to_stage', 'is', null)
        .range(a, b))
      const reachedSets = {}
      for (const a of actsRes.rows) {
        (reachedSets[a.to_stage] ??= new Set()).add(a.lead_id)
      }
      // الليد يُحسب أيضًا في مرحلته الحالية حتى لو لم يُسجَّل له انتقال
      for (const l of leads) (reachedSets[l.stage_id] ??= new Set()).add(l.id)
      setReachedCounts(Object.fromEntries(
        Object.entries(reachedSets).map(([k, v]) => [k, v.size])
      ))

      // ---------- حسب المصدر ----------
      const srcMap = Object.fromEntries((sources ?? []).map(s => [s.id, s.name_ar]))
      const srcCount = {}
      for (const l of leads) {
        const k = srcMap[l.source_id] ?? 'غير محدد'
        srcCount[k] = (srcCount[k] ?? 0) + 1
      }
      setBySource(Object.entries(srcCount)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count))

      // ---------- أسباب الخسارة ----------
      const rMap = Object.fromEntries((reasons ?? []).map(r => [r.id, r.name_ar]))
      const rCount = {}
      for (const l of leads) {
        if (!l.lost_reason_id) continue
        const k = rMap[l.lost_reason_id] ?? 'أخرى'
        rCount[k] = (rCount[k] ?? 0) + 1
      }
      setByLost(Object.entries(rCount)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count))

      // ---------- الإجماليات ----------
      setTotals({
        leads: leads.length,
        deals: deals.length,
        revenue: deals.reduce((a, d) => a + Number(d.net_amount ?? 0), 0),
        collected: pays.reduce((a, p) => a + Number(p.amount ?? 0), 0),
        cohortDeals: cohortLeadIds.size,
      })

      // ---------- ترتيب الفريق (مبيعات + منسقات) ----------
      const nameMap = Object.fromEntries((people ?? [])
        .map(p => [p.id, { name: p.full_name, role: p.roles?.code, status: p.status }]))

      const byPerson = {}
      const ensure = (id) => (byPerson[id] ??= { leads: 0, deals: 0, revenue: 0 })

      for (const l of leads) if (l.owner_id) ensure(l.owner_id).leads++

      // العملية تُنسب للسيلز والمنسقة معًا — أساس العمولة (كما في لوحة التحكم)
      for (const d of deals) {
        const amount = Number(d.net_amount ?? 0)
        if (d.agent_id) { const p = ensure(d.agent_id); p.deals++; p.revenue += amount }
        if (d.coordinator_id && d.coordinator_id !== d.agent_id) {
          const p = ensure(d.coordinator_id); p.deals++; p.revenue += amount
        }
      }

      setTeam(Object.entries(byPerson)
        .map(([id, v]) => ({
          name: nameMap[id]?.name ?? '—',
          role: ROLE_AR[nameMap[id]?.role] ?? '—',
          inactive: nameMap[id]?.status && nameMap[id].status !== 'active',
          ...v,
          ratio: v.leads ? Math.round((v.deals / v.leads) * 100) : null,
        }))
        .sort((a, b) => b.revenue - a.revenue))

      setLoading(false)
    } catch (e) {
      setErr('تعذر تحميل التقرير — ' + (e.message || ''))
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  // نسبتان مختلفتان — لا يجوز الخلط بينهما
  const periodRatio = totals.leads ? Math.round((totals.deals / totals.leads) * 100) : 0
  const cohortRate = totals.leads ? Math.round((totals.cohortDeals / totals.leads) * 100) : 0

  const funnelCounts = funnelMode === 'current' ? stageCounts : reachedCounts

  function doExport() {
    exportCsv(
      `report-${from}-to-${to}.csv`,
      ['الموظف', 'الدور', 'الليدات', 'العمليات', 'الإيراد', 'عمليات/ليدات %'],
      team.map(t => [t.name, t.role, t.leads, t.deals, t.revenue, t.ratio ?? ''])
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
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {warn && <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>{warn}</div>}

      {loading ? (
        <div className="empty">
          جارٍ التحميل…{progress > 0 && ` (${progress.toLocaleString('ar-EG')} ليد)`}
        </div>
      ) : (
        <>
          {/* بطاقات الإجماليات */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
            {[
              { label: 'ليدات الفترة', value: fmtNum(totals.leads) },
              { label: 'عمليات تمت في الفترة', value: fmtNum(totals.deals) },
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
              { label: 'الإيراد (متعاقد)', value: fmtNum(totals.revenue) + ' ر.س', gold: true },
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
              {team.length === 0 ? <div className="empty">لا بيانات في الفترة</div> : (
                <table className="table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>#</th><th>الموظف</th><th>الدور</th><th>ليدات</th><th>عمليات</th><th>الإيراد</th></tr>
                  </thead>
                  <tbody>
                    {team.map((t, i) => (
                      <tr key={t.name + i} style={{ opacity: t.inactive ? .55 : 1 }}>
                        <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                        <td style={{ fontWeight: 600 }}>
                          {t.name}
                          {t.inactive && (
                            <small style={{ color: 'var(--ink-soft)' }}> (موقوف)</small>
                          )}
                        </td>
                        <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t.role}</td>
                        <td>{fmtNum(t.leads)}</td>
                        <td>{fmtNum(t.deals)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(t.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <Breakdowns bySource={bySource} byLostReason={byLost} />
        </>
      )}
    </>
  )
}
