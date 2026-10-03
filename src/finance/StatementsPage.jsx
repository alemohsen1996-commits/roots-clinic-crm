// كشوف الموظفين — للمحاسب والمديرين
// اختيار الشهر ← السيلز أو المنسقات ← الضغط على موظف يعرض عملياته في الشهر:
// المرضى، الفروع، القيم، المحصّل والمتبقي، والعمولة
// العمولة = شرائح على صافي العمليات اللي تمت في الشهر (مش على التحصيل)
// تعريف "عمليات الشهر" = ديلات حالتها تمت وتاريخ النتيجة داخل الشهر (نفس منطق أرشيف الشهور)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum, fmtDate, fmtDateTime, fmtMonth } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import { salesLabel, sortSales } from '../lib/people'
import { useDealRefs } from '../deals/useDealRefs'
import DealDrawer from '../deals/DealDrawer'
import useT from '../i18n/useT'
import i18n from '../i18n'
import { dbName } from '../lib/lang'

const methodLabel = (m) => i18n.t(`payMethod.${m}`, { defaultValue: m })

const thisMonth = () => new Date().toISOString().slice(0, 7)   // YYYY-MM

// حدود الشهر بتوقيت UTC — نفس حساب العمولة وأرشيف الشهور في الداتابيز
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1))
  const to = new Date(Date.UTC(y, m, 1))
  return { fromTs: from.toISOString(), toTs: to.toISOString(), first: `${ym}-01` }
}

const DEAL_SEL = `
  id, lead_id, agent_id, coordinator_id, procedure_no, grafts, operation_date, outcome_at,
  total_amount, tax_amount, net_amount,
  leads(file_no, full_name, phone, branches(name, name_en)),
  procedure_types(name_ar, name_en), techniques(name),
  agent:profiles!deals_agent_id_fkey(full_name),
  coordinator:profiles!deals_coordinator_id_fkey(full_name)
`

const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) ?? 0), 0)
const branchOf = (d) => dbName(d.leads?.branches) || i18n.t('statements.noBranch')

export default function StatementsPage() {
  const { t } = useT()
  const refs = useDealRefs()
  const [month, setMonth] = useState(thisMonth)
  const [tab, setTab] = useState('sales')          // sales | coord
  const [people, setPeople] = useState([])
  const [deals, setDeals] = useState([])
  const [pays, setPays] = useState([])
  const [finance, setFinance] = useState({})       // deal_id → { collected, remaining }
  const [commission, setCommission] = useState({}) // user_id → amount
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selId, setSelId] = useState(null)
  const [openDeal, setOpenDeal] = useState(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    setErr('')
    const { fromTs, toTs, first } = monthRange(month)

    const [pp, dd, py] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, roles!inner(code)')
        .eq('status', 'active')
        .in('roles.code', ['agent', 'sales_manager', 'coordinator']),
      supabase.from('deals').select(DEAL_SEL)
        .eq('status', 'done').gte('outcome_at', fromTs).lt('outcome_at', toTs)
        .order('outcome_at', { ascending: true }),
      supabase.from('payments')
        .select('id, amount, method, paid_at, receipt_no, status, deal_id, deals(agent_id, coordinator_id, leads(file_no, full_name, phone))')
        .neq('status', 'void').gte('paid_at', fromTs).lt('paid_at', toTs)
        .order('paid_at', { ascending: true }),
    ])

    if (pp.error || dd.error || py.error) {
      setErr(t('statements.loadFailed')); setLoading(false); return
    }

    const dealRows = dd.data ?? []
    const ids = dealRows.map(d => d.id)
    const fin = {}
    if (ids.length) {
      const { data: f } = await supabase.from('v_deal_finance')
        .select('deal_id, collected, remaining').in('deal_id', ids)
      for (const r of f ?? []) fin[r.deal_id] = r
    }

    // العمولة من نفس دالة الداتابيز — للسيلز ومديري المبيعات والمنسقات
    const staff = pp.data ?? []
    const comm = {}
    await Promise.all(staff
      .filter(p => ['agent', 'sales_manager', 'coordinator'].includes(p.roles?.code))
      .map(async p => {
        const { data } = await supabase.rpc('calc_commission', { p_user: p.id, p_month: first })
        comm[p.id] = Number(data ?? 0)
      }))

    setPeople(staff)
    setDeals(dealRows)
    setPays(py.data ?? [])
    setFinance(fin)
    setCommission(comm)
    setLoading(false)
  }, [month])

  useEffect(() => { load() }, [load])

  // الموظفين حسب التبويب + ملخص كل واحد
  const key = tab === 'sales' ? 'agent_id' : 'coordinator_id'
  const list = useMemo(() => {
    const staff = tab === 'sales'
      ? sortSales(people.filter(p => ['agent', 'sales_manager'].includes(p.roles?.code)))
      : people.filter(p => p.roles?.code === 'coordinator')
          .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))
    return staff.map(p => {
      const ops = deals.filter(d => d[key] === p.id)
      const myPays = pays.filter(x => x.deals?.[key] === p.id)
      return {
        ...p,
        ops,
        pays: myPays,
        count: ops.length,
        total: sum(ops, d => d.total_amount),
        net: sum(ops, d => d.net_amount),
        collectedMonth: sum(myPays, x => x.amount),
        remaining: sum(ops, d => finance[d.id]?.remaining),
        commission: commission[p.id],
      }
    })
  }, [people, deals, pays, finance, commission, tab, key])

  const sel = list.find(p => p.id === selId) ?? null
  // لو اتغير التبويب والموظف مش فيه، نرجع للقائمة
  useEffect(() => { if (selId && !sel && !loading) setSelId(null) }, [selId, sel, loading])

  function exportSummary() {
    exportCsv(`statements-${tab}-${month}.csv`,
      t('statements.summaryHeaders', { returnObjects: true }),
      list.map(p => [salesLabel(p), p.count, p.total, p.net,
        p.collectedMonth, p.remaining, p.commission ?? '']))
  }

  function exportPerson(p) {
    exportCsv(`statement-${p.full_name}-${month}.csv`,
      [...t('statements.personHeaders', { returnObjects: true }),
       tab === 'sales' ? t('lead.coordShort') : t('rolesShort.agent')],
      p.ops.map(d => [
        d.leads?.file_no, d.leads?.full_name, d.leads?.phone ?? '', branchOf(d), d.procedure_no,
        d.operation_date ?? (d.outcome_at ?? '').slice(0, 10),
        dbName(d.procedure_types), d.techniques?.name ?? '', d.grafts ?? '',
        d.total_amount, d.tax_amount ?? 0, d.net_amount,
        finance[d.id]?.collected ?? 0, finance[d.id]?.remaining ?? 0,
        tab === 'sales' ? d.coordinator?.full_name : d.agent?.full_name,
      ]))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.statements')}</h1>
          <div className="hint">{t('statements.hint', { month: fmtMonth(`${month}-01`) })}</div>
        </div>
      </div>

      <div className="card filters-bar">
        <input type="month" value={month} max={thisMonth()}
          onChange={e => { if (e.target.value) setMonth(e.target.value) }} style={{ width: 170 }} />
        {month !== thisMonth() && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(thisMonth())}>{t('statements.currentMonth')}</button>
        )}
        {!sel && !loading && list.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={exportSummary}>{t('statements.exportSummary')}</button>
        )}
      </div>

      <div className="tabs">
        <button className={'tab' + (tab === 'sales' ? ' on' : '')}
          onClick={() => { setTab('sales'); setSelId(null) }}>{t('dashboard.tabs.sales')}</button>
        <button className={'tab' + (tab === 'coord' ? ' on' : '')}
          onClick={() => { setTab('coord'); setSelId(null) }}>{t('dashboard.tabs.coordinator')}</button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : sel ? (
        <PersonStatement p={sel} tab={tab} finance={finance}
          onBack={() => setSelId(null)} onExport={() => exportPerson(sel)}
          onOpenDeal={setOpenDeal} />
      ) : list.length === 0 ? (
        <div className="card empty">{t('statements.noEmployees')}</div>
      ) : (
        <div className="emp-grid">
          {list.map(p => (
            <button key={p.id} type="button" className="emp-card" onClick={() => setSelId(p.id)}>
              <div className="emp-card-head">
                <strong>{p.full_name}</strong>
                {p.roles?.code === 'sales_manager' && <span className="badge badge-pending">{t('roles.sales_manager')}</span>}
              </div>
              <div className="emp-card-stats">
                <div><span>{t('common.operations')}</span>{fmtNum(p.count)}</div>
                <div><span>{t('statements.opsNet')}</span>{fmtNum(p.net)}</div>
                <div><span>{t('statements.collectedMonth')}</span>{fmtNum(p.collectedMonth)}</div>
                <div className="emp-gold">
                  <span>{t('statements.commission')}</span>{p.commission === undefined ? '—' : fmtNum(p.commission)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {openDeal && (
        <DealDrawer dealId={openDeal.id} refs={refs}
          siblings={sel?.ops ?? []} onNavigate={setOpenDeal}
          onClose={() => setOpenDeal(null)} onChanged={() => load({ quiet: true })} />
      )}
    </>
  )
}

function PersonStatement({ p, tab, finance, onBack, onExport, onOpenDeal }) {
  const { t, isRtl } = useT()
  const SAR = t('common.currency')
  // توزيع العمليات على الفروع
  const branches = useMemo(() => {
    const m = new Map()
    for (const d of p.ops) {
      const b = branchOf(d)
      const r = m.get(b) ?? { name: b, count: 0, total: 0, net: 0 }
      r.count++; r.total += Number(d.total_amount ?? 0); r.net += Number(d.net_amount ?? 0)
      m.set(b, r)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [p.ops])

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>{isRtl ? '→' : '←'} {t('statements.allEmployees')}</button>
            <h2 style={{ margin: '8px 0 0' }}>{salesLabel(p)}</h2>
          </div>
          {p.ops.length > 0 && <button className="btn btn-ghost" onClick={onExport}>{t('statements.exportStatement')}</button>}
        </div>
        <div className="fin-grid" style={{ marginTop: 14 }}>
          <div><span>{t('statements.opsCount')}</span>{fmtNum(p.count)}</div>
          <div><span>{t('statements.contractsValue')}</span>{fmtNum(p.total)} {SAR}</div>
          <div><span>{t('statements.opsNetBase')}</span>{fmtNum(p.net)} {SAR}</div>
          <div><span>{t('statements.collectedMonth')}</span>{fmtNum(p.collectedMonth)} {SAR}</div>
          <div className={p.remaining > 0 ? 'fin-danger' : ''}>
            <span>{t('statements.remainingMonth')}</span>{fmtNum(p.remaining)} {SAR}
          </div>
          <div className="fin-gold">
            <span>{t('statements.commission')}</span>{p.commission === undefined ? '—' : `${fmtNum(p.commission)} ${SAR}`}
          </div>
        </div>
      </div>

      {p.ops.length === 0 ? (
        <div className="card empty">{t('statements.noOps')}</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
            <h3 style={{ margin: '14px 16px 6px' }}>{t('statements.byBranch')}</h3>
            <table className="table">
              <thead><tr><th>{t('lead.branch')}</th><th>{t('common.operations')}</th><th>{t('statements.contractsValue')}</th><th>{t('deals.sorts.net')}</th></tr></thead>
              <tbody>
                {branches.map(b => (
                  <tr key={b.name}>
                    <td style={{ fontWeight: 600 }}>{b.name}</td>
                    <td>{fmtNum(b.count)}</td>
                    <td>{fmtNum(b.total)} {SAR}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(b.net)} {SAR}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
            <h3 style={{ margin: '14px 16px 6px' }}>{t('common.operations')}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('lead.fileNo')}</th><th>{t('statements.patient')}</th><th>{t('lead.phone')}</th><th>{t('lead.branch')}</th><th>{t('payments.date')}</th><th>{t('dealDrawer.type')}</th>
                  <th>{t('dealDrawer.graftsShort')}</th><th>{t('statements.contract')}</th><th>{t('deal.tax')}</th><th>{t('deals.sorts.net')}</th>
                  <th>{t('common.collected')}</th><th>{t('deals.sorts.remaining')}</th><th>{tab === 'sales' ? t('lead.coordShort') : t('rolesShort.agent')}</th>
                </tr>
              </thead>
              <tbody>
                {p.ops.map(d => {
                  const f = finance[d.id]
                  return (
                    <tr key={d.id} onClick={() => onOpenDeal(d)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{d.leads?.file_no}</td>
                      <td style={{ fontWeight: 600 }}>
                        {d.leads?.full_name}
                        {d.procedure_no > 1 && <span className="badge" style={{ marginInlineStart: 6, background: 'var(--gold-soft)', color: 'var(--gold)' }}>{t('deals.operationN', { n: d.procedure_no })}</span>}
                      </td>
                      <td className="ltr-cell" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{d.leads?.phone ?? '—'}</td>
                      <td>{branchOf(d)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.operation_date ?? d.outcome_at)}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {dbName(d.procedure_types) || '—'}{d.techniques?.name ? ` · ${d.techniques.name}` : ''}
                      </td>
                      <td>{d.grafts ? fmtNum(d.grafts) : '—'}</td>
                      <td>{fmtNum(d.total_amount)}</td>
                      <td>{Number(d.tax_amount) > 0 ? fmtNum(d.tax_amount) : '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(d.net_amount)}</td>
                      <td>{fmtNum(f?.collected)}</td>
                      <td style={{ color: Number(f?.remaining) > 0 ? 'var(--danger)' : undefined, fontWeight: 600 }}>
                        {fmtNum(f?.remaining)}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {(tab === 'sales' ? d.coordinator?.full_name : d.agent?.full_name) ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td colSpan={7}>{t('common.total')}</td>
                  <td>{fmtNum(p.total)}</td>
                  <td>{fmtNum(sum(p.ops, d => d.tax_amount))}</td>
                  <td style={{ color: 'var(--gold)' }}>{fmtNum(p.net)}</td>
                  <td>{fmtNum(sum(p.ops, d => finance[d.id]?.collected))}</td>
                  <td>{fmtNum(p.remaining)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ margin: '14px 16px 2px' }}>{t('statements.collectionsMonth')}</h3>
        <p style={{ margin: '0 16px 6px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          {t('statements.collectionsHint')}
        </p>
        {p.pays.length === 0 ? (
          <div className="empty">{t('statements.noCollections')}</div>
        ) : (
          <table className="table">
            <thead><tr><th>{t('payments.receipt')}</th><th>{t('statements.patient')}</th><th>{t('lead.phone')}</th><th>{t('payment.amount')}</th><th>{t('payments.method')}</th><th>{t('payments.date')}</th></tr></thead>
            <tbody>
              {p.pays.map(x => (
                <tr key={x.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{x.receipt_no ?? '—'}</td>
                  <td style={{ fontWeight: 600 }}>
                    {x.deals?.leads?.full_name}
                    <span style={{ color: 'var(--ink-soft)', fontSize: 12, marginInlineStart: 6 }}>{x.deals?.leads?.file_no}</span>
                  </td>
                  <td className="ltr-cell" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{x.deals?.leads?.phone ?? '—'}</td>
                  <td style={{ fontWeight: 700 }}>{fmtNum(x.amount)} {SAR}</td>
                  <td>{methodLabel(x.method)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(x.paid_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800 }}>
                <td colSpan={3}>{t('common.total')}</td>
                <td>{fmtNum(p.collectedMonth)} {SAR}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
