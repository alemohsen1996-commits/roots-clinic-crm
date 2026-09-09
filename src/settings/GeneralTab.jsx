// حدود ومالية — حد موافقة الخصم + شرائح العمولة
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'

const ROLE_AR = { agent: 'موظف مبيعات', coordinator: 'منسقة' }

export default function GeneralTab() {
  const [amount, setAmount] = useState('')
  const [percent, setPercent] = useState('')
  const [tiers, setTiers] = useState([])
  const [newTier, setNewTier] = useState({ role_code: 'agent', min_amount: '', max_amount: '', pct: '' })
  const [msg, setMsg] = useState(null)     // { ok, t }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: s }, { data: t }] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'discount_approval_threshold').maybeSingle(),
      supabase.from('commission_tiers').select('*').order('role_code').order('min_amount'),
    ])
    setAmount(String(s?.value?.amount ?? 2000))
    setPercent(String(s?.value?.percent ?? 10))
    setTiers(t ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const say = (ok, t) => { setMsg({ ok, t }); setTimeout(() => setMsg(null), 4000) }

  async function saveThreshold() {
    setBusy(true)
    // upsert لا update: لو المفتاح غير موجود فإن update يعدّل صفر صفوف بصمت
    const { error } = await supabase.from('settings').upsert({
      key: 'discount_approval_threshold',
      value: { amount: Number(amount), percent: Number(percent) },
    }, { onConflict: 'key' })
    setBusy(false)
    if (error) { say(false, 'تعذر الحفظ — ' + error.message); return }
    say(true, 'تم الحفظ')
    load()
  }

  // ---------- تحقّق من تداخل الشرائح ----------
  // شريحتان متداخلتان لنفس الدور تجعلان حساب العمولة غامضًا
  function overlapError(t, list) {
    const min = Number(t.min_amount)
    const max = t.max_amount ? Number(t.max_amount) : Infinity
    if (max <= min) return 'الحد الأعلى يجب أن يكون أكبر من الأدنى'
    for (const o of list) {
      if (o.role_code !== t.role_code) continue
      const oMin = Number(o.min_amount)
      const oMax = o.max_amount ? Number(o.max_amount) : Infinity
      if (min < oMax && oMin < max) {
        return `تتداخل مع شريحة ${fmtNum(oMin)} — ${o.max_amount ? fmtNum(oMax) : 'بلا حد'}`
      }
    }
    return null
  }

  // فجوات غير مغطاة — تحذير لا منع
  const gaps = useMemo(() => {
    const out = []
    for (const role of ['agent', 'coordinator']) {
      const list = tiers.filter(t => t.role_code === role)
        .sort((a, b) => Number(a.min_amount) - Number(b.min_amount))
      if (!list.length) continue
      if (Number(list[0].min_amount) > 0) {
        out.push(`${ROLE_AR[role]}: لا توجد شريحة تغطي من 0 إلى ${fmtNum(list[0].min_amount)}`)
      }
      for (let i = 0; i < list.length - 1; i++) {
        const end = list[i].max_amount ? Number(list[i].max_amount) : Infinity
        const nextStart = Number(list[i + 1].min_amount)
        if (end < nextStart) {
          out.push(`${ROLE_AR[role]}: فجوة بين ${fmtNum(end)} و ${fmtNum(nextStart)}`)
        }
      }
      const last = list[list.length - 1]
      if (last.max_amount) {
        out.push(`${ROLE_AR[role]}: لا توجد شريحة لما يتجاوز ${fmtNum(last.max_amount)}`)
      }
    }
    return out
  }, [tiers])

  async function addTier() {
    setMsg(null)
    if (!newTier.min_amount || !newTier.pct) { say(false, 'أدخل الحد الأدنى والنسبة'); return }
    if (Number(newTier.pct) <= 0 || Number(newTier.pct) > 100) { say(false, 'النسبة يجب أن تكون بين 1 و 100'); return }

    const bad = overlapError(newTier, tiers)
    if (bad) { say(false, bad); return }

    setBusy(true)
    const { error } = await supabase.from('commission_tiers').insert({
      role_code: newTier.role_code,
      min_amount: Number(newTier.min_amount),
      max_amount: newTier.max_amount ? Number(newTier.max_amount) : null,
      pct: Number(newTier.pct),
    })
    setBusy(false)
    if (error) { say(false, 'تعذر الإضافة — ' + error.message); return }
    setNewTier({ role_code: 'agent', min_amount: '', max_amount: '', pct: '' })
    say(true, 'تمت إضافة الشريحة')
    load()
  }

  async function delTier(t) {
    const label = `${ROLE_AR[t.role_code]} · من ${fmtNum(t.min_amount)} · ${t.pct}٪`
    if (!window.confirm(`حذف شريحة العمولة:\n${label}\n\nهل أنت متأكد؟`)) return
    setBusy(true)
    const { error } = await supabase.from('commission_tiers').delete().eq('id', t.id)
    setBusy(false)
    if (error) { say(false, 'تعذر الحذف — ' + error.message); return }
    say(true, 'تم حذف الشريحة')
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>حد موافقة الخصم</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
          أي خصم يتجاوز أيًا من الحدين يذهب لموافقتك تلقائيًا قبل السريان
        </p>
        <div className="field">
          <label>الحد بالمبلغ (ر.س)</label>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label>الحد بالنسبة (٪ من قيمة التعاقد)</label>
          <input type="number" min={0} max={100} value={percent} onChange={e => setPercent(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={saveThreshold} disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>

      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>شرائح العمولة</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            تُحسب على المحصّل فعليًا خلال الشهر — لا على المتعاقد عليه
          </p>
        </div>

        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')} style={{ margin: 12 }}>
            {msg.t}
          </div>
        )}

        {gaps.length > 0 && (
          <div className="alert" style={{
            background: 'var(--warn-soft)', color: 'var(--warn)', margin: 12, lineHeight: 1.8,
          }}>
            <b>مبالغ بلا شريحة عمولة:</b>
            {gaps.map((g, i) => <div key={i}>• {g}</div>)}
          </div>
        )}

        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>الدور</th><th>من</th><th>إلى</th><th>النسبة</th><th></th></tr>
          </thead>
          <tbody>
            {tiers.map(t => (
              <tr key={t.id}>
                <td>{ROLE_AR[t.role_code] ?? t.role_code}</td>
                <td>{fmtNum(t.min_amount)} ر.س</td>
                <td>{t.max_amount ? fmtNum(t.max_amount) + ' ر.س' : 'بلا حد'}</td>
                <td style={{ fontWeight: 700, color: 'var(--gold)' }}>{t.pct}٪</td>
                <td>
                  <button className="btn btn-danger" onClick={() => delTier(t)} disabled={busy}>
                    حذف
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <select value={newTier.role_code} onChange={e => setNewTier(n => ({ ...n, role_code: e.target.value }))}
                  style={{ padding: '6px 8px' }}>
                  <option value="agent">موظف مبيعات</option>
                  <option value="coordinator">منسقة</option>
                </select>
              </td>
              <td><input type="number" placeholder="من" value={newTier.min_amount}
                onChange={e => setNewTier(n => ({ ...n, min_amount: e.target.value }))}
                style={{ width: 90, padding: '6px 8px' }} /></td>
              <td><input type="number" placeholder="بلا حد" value={newTier.max_amount}
                onChange={e => setNewTier(n => ({ ...n, max_amount: e.target.value }))}
                style={{ width: 90, padding: '6px 8px' }} /></td>
              <td><input type="number" placeholder="٪" value={newTier.pct}
                onChange={e => setNewTier(n => ({ ...n, pct: e.target.value }))}
                style={{ width: 60, padding: '6px 8px' }} /></td>
              <td>
                <button className="btn btn-primary" onClick={addTier} disabled={busy}>إضافة</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
