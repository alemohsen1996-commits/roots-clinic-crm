// لوحة التحكم — أرقام أي شهر (للموظف وللمدير)
// تُحسب من الديلات والدفعات مباشرة، فتعمل لأي شهر مضى
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtMonth } from '../lib/format'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US')

const monthKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}
const thisMonth = () => monthKey(new Date())

const monthLabel = (m) => fmtMonth(m)

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
  const { profile, isManager } = useAuth()
  const [rows, setRows] = useState([])       // أداء الفريق (الشهر الجاري)
  const [series, setSeries] = useState([])   // سلسلة الشهور
  const [month, setMonth] = useState(thisMonth())
  const [target, setTarget] = useState(0)
  const [loading, setLoading] = useState(true)

  // أداء الفريق — الشهر الجاري فقط
  useEffect(() => {
    if (!isManager) return
    supabase.from('v_month_to_date').select('*')
      .then(({ data }) => setRows(data ?? []))
  }, [isManager])

  const loadSeries = useCallback(async () => {
    setLoading(true)
    const { data } = isManager
      ? await supabase.rpc('clinic_monthly_series')
      : await supabase.rpc('user_monthly_series', { p_user: profile?.id })
    setSeries(data ?? [])
    setLoading(false)
  }, [isManager, profile?.id])

  useEffect(() => { loadSeries() }, [loadSeries])

  // الهدف الشهري قيمة واحدة في profiles — تخصّ الشهر الجاري فقط
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('profiles').select('monthly_target').eq('id', profile.id).maybeSingle()
      .then(({ data }) => setTarget(Number(data?.monthly_target ?? 0)))
  }, [profile?.id])

  // قائمة الشهور المتاحة — مع ضمان وجود الشهر الجاري
  const months = useMemo(() => {
    const set = new Set(series.map(r => monthKey(r.month)))
    set.add(thisMonth())
    return [...set].sort().reverse()
  }, [series])

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
      ]
    : [
        { label: 'عملياتي', value: fmt(cur?.deals_count), before: prev?.deals_count },
        { label: 'إيرادي', value: fmt(cur?.revenue) + ' ر.س', gold: true, before: prev?.revenue },
        { label: 'المحصّل من عملائي', value: fmt(cur?.collected) + ' ر.س', before: prev?.collected },
        { label: 'ليداتي الواردة', value: fmt(cur?.leads_received), before: prev?.leads_received },
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {cards.map(c => (
              <div key={c.label} className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 6 }}>{c.label}</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
                  color: c.gold ? 'var(--gold)' : 'var(--ink)',
                }}>{c.value}</div>
                <div style={{ marginTop: 6, minHeight: 18 }}>
                  <Delta now={
                    c.label.includes('الإيراد') || c.label.includes('إيرادي') ? cur?.revenue
                    : c.label.includes('المحصّل') ? cur?.collected
                    : c.label.includes('الليدات') || c.label.includes('ليداتي')
                      ? (cur?.leads_count ?? cur?.leads_received)
                    : cur?.deals_count
                  } before={c.before} />
                </div>
              </div>
            ))}
          </div>

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

          {!cur && (
            <div className="card empty" style={{ marginTop: 16 }}>
              <strong>لا أرقام في {monthLabel(month)}</strong>
              لم تُسجَّل عمليات أو تحصيلات في هذا الشهر
            </div>
          )}

          {/* سجل الشهور */}
          {series.length > 1 && (
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

          {/* أداء الفريق — الشهر الجاري فقط */}
          {isManager && isCurrentMonth && rows.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div style={{ padding: '16px 16px 0' }}>
                <h2 style={{ fontSize: 16 }}>أداء الفريق هذا الشهر</h2>
                <div className="hint" style={{ marginTop: 4 }}>
                  العملية الواحدة تُنسب للسيلز والمنسقة معًا لحساب العمولة —
                  لذلك مجموع الصفوف أكبر من إجمالي العيادة بالأعلى
                </div>
              </div>
              <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="table sticky-head">
                <thead>
                  <tr><th>الموظف</th><th>العمليات</th><th>الإيراد</th><th>المحصّل</th><th>الليدات</th></tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                    .map(r => (
                      <tr key={r.user_id}>
                        <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                        <td>{fmt(r.deals_count)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(r.revenue)} ر.س</td>
                        <td>{fmt(r.collected)} ر.س</td>
                        <td>{fmt(r.leads_received)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
