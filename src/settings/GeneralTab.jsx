// حدود ومالية — حد موافقة الخصم + شرائح العمولة
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

export default function GeneralTab() {
  const { t: tr } = useT()
  const SAR = tr('common.currency')
  const ROLE = (code) => tr(`roles.${code}`, { defaultValue: code })
  const noLimit = tr('leads.f.noLimit')
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
    if (error) { say(false, tr('addLead.saveFailed') + ' — ' + dbErr(error.message)); return }
    say(true, tr('general.saved'))
    load()
  }

  // ---------- تحقّق من تداخل الشرائح ----------
  // شريحتان متداخلتان لنفس الدور تجعلان حساب العمولة غامضًا
  function overlapError(t, list) {
    const min = Number(t.min_amount)
    const max = t.max_amount ? Number(t.max_amount) : Infinity
    if (max <= min) return tr('general.maxGtMin')
    for (const o of list) {
      if (o.role_code !== t.role_code) continue
      const oMin = Number(o.min_amount)
      const oMax = o.max_amount ? Number(o.max_amount) : Infinity
      if (min < oMax && oMin < max) {
        return tr('general.overlaps', { range: `${fmtNum(oMin)} — ${o.max_amount ? fmtNum(oMax) : noLimit}` })
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
        out.push(`${ROLE(role)}: ${tr('general.gapFromZero', { n: fmtNum(list[0].min_amount) })}`)
      }
      for (let i = 0; i < list.length - 1; i++) {
        const end = list[i].max_amount ? Number(list[i].max_amount) : Infinity
        const nextStart = Number(list[i + 1].min_amount)
        if (end < nextStart) {
          out.push(`${ROLE(role)}: ${tr('general.gapBetween', { a: fmtNum(end), b: fmtNum(nextStart) })}`)
        }
      }
      const last = list[list.length - 1]
      if (last.max_amount) {
        out.push(`${ROLE(role)}: ${tr('general.gapAbove', { n: fmtNum(last.max_amount) })}`)
      }
    }
    return out
  }, [tiers, tr])

  async function addTier() {
    setMsg(null)
    if (!newTier.min_amount || !newTier.pct) { say(false, tr('general.minAndPct')); return }
    if (Number(newTier.pct) <= 0 || Number(newTier.pct) > 100) { say(false, tr('general.pctRange')); return }

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
    if (error) { say(false, tr('general.addFailed') + ' — ' + dbErr(error.message)); return }
    setNewTier({ role_code: 'agent', min_amount: '', max_amount: '', pct: '' })
    say(true, tr('general.tierAdded'))
    load()
  }

  async function delTier(t) {
    const label = `${ROLE(t.role_code)} · ${tr('drawer.from')} ${fmtNum(t.min_amount)} · ${t.pct}%`
    if (!window.confirm(`${tr('general.deleteTierQ')}:\n${label}\n\n${tr('common.proceedQ')}`)) return
    setBusy(true)
    const { error } = await supabase.from('commission_tiers').delete().eq('id', t.id)
    setBusy(false)
    if (error) { say(false, tr('general.deleteFailed') + ' — ' + dbErr(error.message)); return }
    say(true, tr('general.tierDeleted'))
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>{tr('general.discountTitle')}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
          {tr('general.discountHint')}
        </p>
        <div className="field">
          <label>{tr('general.limitAmount')} ({SAR})</label>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label>{tr('general.limitPct')}</label>
          <input type="number" min={0} max={100} value={percent} onChange={e => setPercent(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={saveThreshold} disabled={busy}>
          {busy ? tr('common.saving') : tr('common.save')}
        </button>
      </div>

      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>{tr('general.tiersTitle')}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {tr('general.tiersHint')}
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
            <b>{tr('general.gapsTitle')}</b>
            {gaps.map((g, i) => <div key={i}>• {g}</div>)}
          </div>
        )}

        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>{tr('common.role')}</th><th>{tr('drawer.from')}</th><th>{tr('leads.f.to')}</th><th>{tr('general.pct')}</th><th></th></tr>
          </thead>
          <tbody>
            {tiers.map(t => (
              <tr key={t.id}>
                <td>{ROLE(t.role_code)}</td>
                <td>{fmtNum(t.min_amount)} {SAR}</td>
                <td>{t.max_amount ? fmtNum(t.max_amount) + ' ' + SAR : noLimit}</td>
                <td style={{ fontWeight: 700, color: 'var(--gold)' }}>{t.pct}%</td>
                <td>
                  <button className="btn btn-danger" onClick={() => delTier(t)} disabled={busy}>
                    {tr('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <select value={newTier.role_code} onChange={e => setNewTier(n => ({ ...n, role_code: e.target.value }))}
                  style={{ padding: '6px 8px' }}>
                  <option value="agent">{tr('roles.agent')}</option>
                  <option value="coordinator">{tr('roles.coordinator')}</option>
                </select>
              </td>
              <td><input type="number" placeholder={tr('drawer.from')} value={newTier.min_amount}
                onChange={e => setNewTier(n => ({ ...n, min_amount: e.target.value }))}
                style={{ width: 90, padding: '6px 8px' }} /></td>
              <td><input type="number" placeholder={noLimit} value={newTier.max_amount}
                onChange={e => setNewTier(n => ({ ...n, max_amount: e.target.value }))}
                style={{ width: 90, padding: '6px 8px' }} /></td>
              <td><input type="number" placeholder="%" value={newTier.pct}
                onChange={e => setNewTier(n => ({ ...n, pct: e.target.value }))}
                style={{ width: 60, padding: '6px 8px' }} /></td>
              <td>
                <button className="btn btn-primary" onClick={addTier} disabled={busy}>{tr('common.add')}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
