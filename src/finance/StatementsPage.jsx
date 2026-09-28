// كشوف الموظفين — للمحاسب والمديرين
// اختيار الشهر ← السيلز أو المنسقات ← الضغط على موظف يعرض عملياته في الشهر:
// المرضى، الفروع، القيم، المحصّل والمتبقي، والعمولة
// تعريف "عمليات الشهر" = ديلات حالتها تمت وتاريخ النتيجة داخل الشهر (نفس منطق أرشيف الشهور)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum, fmtDate, fmtDateTime, fmtMonth } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import { salesLabel, sortSales } from '../lib/people'
import { useDealRefs } from '../deals/useDealRefs'
import DealDrawer from '../deals/DealDrawer'

const METHOD_AR = {
  cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل',
  tabby: 'تابي', tamara: 'تمارا', other: 'أخرى',
}

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
  leads(file_no, full_name, phone, branches(name)),
  procedure_types(name_ar), techniques(name),
  agent:profiles!deals_agent_id_fkey(full_name),
  coordinator:profiles!deals_coordinator_id_fkey(full_name)
`

const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) ?? 0), 0)
const branchOf = (d) => d.leads?.branches?.name ?? 'بدون فرع'

export default function StatementsPage() {
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
      setErr('تعذر تحميل البيانات'); setLoading(false); return
    }

    const dealRows = dd.data ?? []
    const ids = dealRows.map(d => d.id)
    const fin = {}
    if (ids.length) {
      const { data: f } = await supabase.from('v_deal_finance')
        .select('deal_id, collected, remaining').in('deal_id', ids)
      for (const r of f ?? []) fin[r.deal_id] = r
    }

    // العمولة من نفس دالة الداتابيز — للسيلز والمنسقات فقط
    const staff = pp.data ?? []
    const comm = {}
    await Promise.all(staff
      .filter(p => ['agent', 'coordinator'].includes(p.roles?.code))
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
      ['الموظف', 'عدد العمليات', 'قيمة التعاقدات', 'صافي العيادة',
       'المحصّل في الشهر', 'المتبقي على المرضى', 'العمولة'],
      list.map(p => [salesLabel(p), p.count, p.total, p.net,
        p.collectedMonth, p.remaining, p.commission ?? '']))
  }

  function exportPerson(p) {
    exportCsv(`statement-${p.full_name}-${month}.csv`,
      ['رقم الملف', 'المريض', 'الهاتف', 'الفرع', 'رقم العملية', 'تاريخ العملية', 'النوع', 'التقنية',
       'البصيلات', 'قيمة التعاقد', 'الضريبة', 'الصافي', 'المحصّل', 'المتبقي',
       tab === 'sales' ? 'المنسقة' : 'السيلز'],
      p.ops.map(d => [
        d.leads?.file_no, d.leads?.full_name, d.leads?.phone ?? '', branchOf(d), d.procedure_no,
        d.operation_date ?? (d.outcome_at ?? '').slice(0, 10),
        d.procedure_types?.name_ar ?? '', d.techniques?.name ?? '', d.grafts ?? '',
        d.total_amount, d.tax_amount ?? 0, d.net_amount,
        finance[d.id]?.collected ?? 0, finance[d.id]?.remaining ?? 0,
        tab === 'sales' ? d.coordinator?.full_name : d.agent?.full_name,
      ]))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>كشوف الموظفين</h1>
          <div className="hint">عمليات {fmtMonth(`${month}-01`)} لكل موظف · العمليات = الديلات اللي تمت في الشهر</div>
        </div>
      </div>

      <div className="card filters-bar">
        <input type="month" value={month} max={thisMonth()}
          onChange={e => { if (e.target.value) setMonth(e.target.value) }} style={{ width: 170 }} />
        {month !== thisMonth() && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(thisMonth())}>الشهر الحالي</button>
        )}
        {!sel && !loading && list.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={exportSummary}>تصدير الملخص</button>
        )}
      </div>

      <div className="tabs">
        <button className={'tab' + (tab === 'sales' ? ' on' : '')}
          onClick={() => { setTab('sales'); setSelId(null) }}>السيلز</button>
        <button className={'tab' + (tab === 'coord' ? ' on' : '')}
          onClick={() => { setTab('coord'); setSelId(null) }}>المنسقات</button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : sel ? (
        <PersonStatement p={sel} tab={tab} finance={finance}
          onBack={() => setSelId(null)} onExport={() => exportPerson(sel)}
          onOpenDeal={setOpenDeal} />
      ) : list.length === 0 ? (
        <div className="card empty">لا يوجد موظفين</div>
      ) : (
        <div className="emp-grid">
          {list.map(p => (
            <button key={p.id} type="button" className="emp-card" onClick={() => setSelId(p.id)}>
              <div className="emp-card-head">
                <strong>{p.full_name}</strong>
                {p.roles?.code === 'sales_manager' && <span className="badge badge-pending">مدير مبيعات</span>}
              </div>
              <div className="emp-card-stats">
                <div><span>العمليات</span>{fmtNum(p.count)}</div>
                <div><span>قيمة التعاقدات</span>{fmtNum(p.total)}</div>
                <div><span>المحصّل في الشهر</span>{fmtNum(p.collectedMonth)}</div>
                <div className="emp-gold">
                  <span>العمولة</span>{p.commission === undefined ? '—' : fmtNum(p.commission)}
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
            <button className="btn btn-ghost btn-sm" onClick={onBack}>→ كل الموظفين</button>
            <h2 style={{ margin: '8px 0 0' }}>{salesLabel(p)}</h2>
          </div>
          {p.ops.length > 0 && <button className="btn btn-ghost" onClick={onExport}>تصدير الكشف</button>}
        </div>
        <div className="fin-grid" style={{ marginTop: 14 }}>
          <div><span>عدد العمليات</span>{fmtNum(p.count)}</div>
          <div><span>قيمة التعاقدات</span>{fmtNum(p.total)} ر.س</div>
          <div><span>صافي العيادة</span>{fmtNum(p.net)} ر.س</div>
          <div><span>المحصّل في الشهر</span>{fmtNum(p.collectedMonth)} ر.س</div>
          <div className={p.remaining > 0 ? 'fin-danger' : ''}>
            <span>المتبقي على مرضى الشهر</span>{fmtNum(p.remaining)} ر.س
          </div>
          <div className="fin-gold">
            <span>العمولة</span>{p.commission === undefined ? '—' : `${fmtNum(p.commission)} ر.س`}
          </div>
        </div>
      </div>

      {p.ops.length === 0 ? (
        <div className="card empty">لا توجد عمليات منفذة في هذا الشهر</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
            <h3 style={{ margin: '14px 16px 6px' }}>التوزيع على الفروع</h3>
            <table className="table">
              <thead><tr><th>الفرع</th><th>العمليات</th><th>قيمة التعاقدات</th><th>الصافي</th></tr></thead>
              <tbody>
                {branches.map(b => (
                  <tr key={b.name}>
                    <td style={{ fontWeight: 600 }}>{b.name}</td>
                    <td>{fmtNum(b.count)}</td>
                    <td>{fmtNum(b.total)} ر.س</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(b.net)} ر.س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
            <h3 style={{ margin: '14px 16px 6px' }}>العمليات</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>الملف</th><th>المريض</th><th>الهاتف</th><th>الفرع</th><th>التاريخ</th><th>النوع</th>
                  <th>البصيلات</th><th>التعاقد</th><th>الضريبة</th><th>الصافي</th>
                  <th>المحصّل</th><th>المتبقي</th><th>{tab === 'sales' ? 'المنسقة' : 'السيلز'}</th>
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
                        {d.procedure_no > 1 && <span className="badge" style={{ marginInlineStart: 6, background: 'var(--gold-soft)', color: 'var(--gold)' }}>عملية {d.procedure_no}</span>}
                      </td>
                      <td dir="ltr" style={{ fontSize: 12.5, whiteSpace: 'nowrap', textAlign: 'right' }}>{d.leads?.phone ?? '—'}</td>
                      <td>{branchOf(d)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.operation_date ?? d.outcome_at)}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {d.procedure_types?.name_ar ?? '—'}{d.techniques?.name ? ` · ${d.techniques.name}` : ''}
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
                  <td colSpan={7}>الإجمالي</td>
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
        <h3 style={{ margin: '14px 16px 2px' }}>التحصيلات في الشهر</h3>
        <p style={{ margin: '0 16px 6px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          كل الفلوس اللي اتحصلت في الشهر من مرضى الموظف (حتى لو العملية في شهر تاني) — وهي أساس حساب العمولة
        </p>
        {p.pays.length === 0 ? (
          <div className="empty">لا توجد تحصيلات في هذا الشهر</div>
        ) : (
          <table className="table">
            <thead><tr><th>الإيصال</th><th>المريض</th><th>الهاتف</th><th>المبلغ</th><th>الطريقة</th><th>التاريخ</th></tr></thead>
            <tbody>
              {p.pays.map(x => (
                <tr key={x.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{x.receipt_no ?? '—'}</td>
                  <td style={{ fontWeight: 600 }}>
                    {x.deals?.leads?.full_name}
                    <span style={{ color: 'var(--ink-soft)', fontSize: 12, marginInlineStart: 6 }}>{x.deals?.leads?.file_no}</span>
                  </td>
                  <td dir="ltr" style={{ fontSize: 12.5, whiteSpace: 'nowrap', textAlign: 'right' }}>{x.deals?.leads?.phone ?? '—'}</td>
                  <td style={{ fontWeight: 700 }}>{fmtNum(x.amount)} ر.س</td>
                  <td>{METHOD_AR[x.method] ?? x.method}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(x.paid_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800 }}>
                <td colSpan={3}>الإجمالي</td>
                <td>{fmtNum(p.collectedMonth)} ر.س</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
