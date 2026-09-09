// أرشيف الشهور — الأرقام المجمّدة بعد التصفير الشهري
// اختيار أي شهر + مقارنة شهرين جنبًا إلى جنب + تصدير
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'

const monthLabel = (m) =>
  new Date(m).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })

export default function ArchivePage() {
  const [months, setMonths] = useState([])
  const [sel, setSel] = useState('')
  const [cmp, setCmp] = useState('')          // شهر المقارنة (اختياري)
  const [rows, setRows] = useState([])
  const [cmpRows, setCmpRows] = useState([])
  const [loading, setLoading] = useState(true)

  // الشهور المتاحة في الأرشيف
  useEffect(() => {
    supabase.from('monthly_archive').select('month')
      .order('month', { ascending: false })
      .then(({ data }) => {
        const uniq = [...new Set((data ?? []).map(r => r.month))]
        setMonths(uniq)
        if (uniq[0]) setSel(uniq[0])
        setLoading(false)
      })
  }, [])

  const load = useCallback(async () => {
    if (!sel) return
    const { data } = await supabase
      .from('monthly_archive')
      .select('*, profiles(full_name)')
      .eq('month', sel)
      .order('revenue', { ascending: false })
    setRows(data ?? [])
    if (cmp) {
      const { data: c } = await supabase
        .from('monthly_archive')
        .select('user_id, deals_count, revenue, collected, commission')
        .eq('month', cmp)
      setCmpRows(c ?? [])
    } else setCmpRows([])
  }, [sel, cmp])

  useEffect(() => { load() }, [load])

  const cmpMap = Object.fromEntries(cmpRows.map(r => [r.user_id, r]))
  const totals = rows.reduce((a, r) => ({
    deals: a.deals + r.deals_count,
    revenue: a.revenue + Number(r.revenue),
    collected: a.collected + Number(r.collected),
    commission: a.commission + Number(r.commission),
  }), { deals: 0, revenue: 0, collected: 0, commission: 0 })

  // سهم التغير مقارنة بشهر المقارنة
  const Delta = ({ now, before }) => {
    if (before === undefined || before === null) return null
    const b = Number(before), n = Number(now)
    if (b === 0) return null
    const pct = Math.round(((n - b) / b) * 100)
    if (pct === 0) return <small style={{ color: 'var(--ink-soft)' }}> =</small>
    return (
      <small style={{ color: pct > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>
        {' '}{pct > 0 ? '▲' : '▼'}{Math.abs(pct)}٪
      </small>
    )
  }

  function doExport() {
    exportCsv(
      `archive-${sel}.csv`,
      ['الموظف', 'الدور', 'العمليات', 'الإيراد', 'المحصّل', 'العمولة', 'الليدات', 'التحويل %'],
      rows.map(r => [
        r.profiles?.full_name, r.role_code === 'coordinator' ? 'منسقة' : 'مبيعات',
        r.deals_count, r.revenue, r.collected, r.commission,
        r.leads_received, r.conversion_pct,
      ])
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>أرشيف الشهور</h1>
          <div className="hint">أرقام مجمّدة تُحفظ تلقائيًا عند تصفير كل شهر — لا تُحذف أبدًا</div>
        </div>
        {rows.length > 0 && <button className="btn btn-ghost" onClick={doExport}>تصدير Excel (CSV)</button>}
      </div>

      {loading ? <div className="empty">جارٍ التحميل…</div> :
       months.length === 0 ? (
        <div className="card empty">
          <strong>لا أرشيف بعد</strong>
          أول snapshot سيُحفظ تلقائيًا مطلع الشهر القادم (مهمة close-month المجدولة)
        </div>
      ) : (
        <>
          <div className="card filters-bar">
            <label style={{ fontSize: 13, fontWeight: 600 }}>الشهر</label>
            <select value={sel} onChange={e => setSel(e.target.value)}>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <label style={{ fontSize: 13, fontWeight: 600 }}>مقارنة بـ</label>
            <select value={cmp} onChange={e => setCmp(e.target.value)}>
              <option value="">— بدون مقارنة —</option>
              {months.filter(m => m !== sel).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>

          {/* إجماليات الشهر */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
            {[
              { label: 'إجمالي العمليات', value: fmtNum(totals.deals) },
              { label: 'الإيراد', value: fmtNum(totals.revenue) + ' ر.س', gold: true },
              { label: 'المحصّل', value: fmtNum(totals.collected) + ' ر.س', gold: true },
              { label: 'العمولات المستحقة', value: fmtNum(totals.commission) + ' ر.س' },
            ].map(c => (
              <div key={c.label} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.label}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: c.gold ? 'var(--gold)' : 'var(--ink)' }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div style={{ padding: '16px 16px 0' }}>
              <h2 style={{ fontSize: 16 }}>
                تفاصيل {monthLabel(sel)}
                {cmp && <small style={{ color: 'var(--ink-soft)', fontWeight: 500 }}> — مقارنة بـ {monthLabel(cmp)}</small>}
              </h2>
            </div>
            <table className="table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>الموظف</th><th>الدور</th><th>العمليات</th>
                  <th>الإيراد</th><th>المحصّل</th><th>العمولة</th><th>التحويل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const b = cmpMap[r.user_id]
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.profiles?.full_name}</td>
                      <td>{r.role_code === 'coordinator' ? 'منسقة' : 'مبيعات'}</td>
                      <td>{fmtNum(r.deals_count)}<Delta now={r.deals_count} before={b?.deals_count} /></td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>
                        {fmtNum(r.revenue)}<Delta now={r.revenue} before={b?.revenue} />
                      </td>
                      <td>{fmtNum(r.collected)}<Delta now={r.collected} before={b?.collected} /></td>
                      <td>{fmtNum(r.commission)}<Delta now={r.commission} before={b?.commission} /></td>
                      <td>{r.conversion_pct}٪</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
