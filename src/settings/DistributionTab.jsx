// إعدادات توزيع الليدات — النمط + مهلة إعادة التوزيع + نظرة على الفريق
// ملاحظة: التوزيع التلقائي غير مفعّل حاليًا — العمل يتم عبر صفحة «توزيع الليدات» (/distribute)
import { useCallback, useEffect, useState } from 'react'
import { SALES_ROLES, salesLabel, sortSales } from '../lib/people'
import { supabase } from '../lib/supabase'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

// الأسماء والشرح من الترجمة: distTab.modes.*
const MODES = ['round_robin', 'weighted', 'skill', 'cherry_pick']

export default function DistributionTab() {
  const { t: tr } = useT()
  const [mode, setMode] = useState('')
  const [minutes, setMinutes] = useState('')
  const [team, setTeam] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: st }, { data: s }, { data: t }] = await Promise.all([
      supabase.from('distribution_state').select('mode').eq('id', 1).maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'reassign_untouched_minutes').maybeSingle(),
      supabase.from('profiles')
        .select('full_name, weight, daily_cap, in_rotation, languages, roles!inner(code)')
        .eq('status', 'active').in('roles.code', SALES_ROLES),
    ])
    setMode(st?.mode ?? 'weighted')
    setMinutes(String(s?.value ?? 15))
    setTeam(sortSales(t ?? []))
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    setBusy(true)
    const [r1, r2] = await Promise.all([
      supabase.from('distribution_state')
        .update({ mode, updated_at: new Date().toISOString() }).eq('id', 1),
      // upsert لا update — لو المفتاح غير موجود فلن يُحفظ شيء بصمت
      supabase.from('settings')
        .upsert({ key: 'reassign_untouched_minutes', value: Number(minutes) }, { onConflict: 'key' }),
    ])
    setBusy(false)
    const error = r1.error || r2.error
    if (error) { setMsg({ ok: false, t: tr('addLead.saveFailed') + ' — ' + dbErr(error.message) }); return }
    setMsg({ ok: true, t: tr('distTab.saved') })
    setTimeout(() => setMsg(null), 3500)
    load()
  }

  const inRotation = team.filter(t => t.in_rotation)
  const totalWeight = inRotation.reduce((a, t) => a + t.weight, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>{tr('distTab.modeTitle')}</h2>

        <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', lineHeight: 1.8 }}>
          <b>{tr('distTab.notEnabled')}</b><br />
          {tr('distTab.notEnabledBody')}
        </div>

        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')}>{msg.t}</div>
        )}

        <div style={{ opacity: .75 }}>
          {MODES.map(m => (
            <label key={m} className="mode-option" data-on={mode === m}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              <div><b>{tr(`distTab.modes.${m}.label`)}</b><small>{tr(`distTab.modes.${m}.desc`)}</small></div>
            </label>
          ))}
        </div>

        <div className="field" style={{ marginTop: 16, opacity: .75 }}>
          <label>{tr('distTab.reclaimAfter')}</label>
          <input type="number" min={5} value={minutes} onChange={e => setMinutes(e.target.value)} />
          <small style={{ color: 'var(--ink-soft)' }}>
            {tr('distTab.reclaimNote')}
          </small>
        </div>

        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? tr('common.saving') : tr('distTab.saveSettings')}
        </button>
      </div>

      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>{tr('deals.team')} ({inRotation.length})</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {tr('distTab.weightHint')}
          </p>
        </div>
        {inRotation.length === 0 ? (
          <div className="empty">
            <strong>{tr('distTab.nobody')}</strong>
            {tr('distTab.nobodyHint')}
          </div>
        ) : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{tr('common.employee')}</th><th>{tr('distTab.weight')}</th><th>{tr('distTab.expectedShare')}</th><th>{tr('team.dailyCap')}</th><th>{tr('distTab.languages')}</th></tr>
            </thead>
            <tbody>
              {inRotation.map(t => (
                <tr key={t.full_name}>
                  <td style={{ fontWeight: 600 }}>{salesLabel(t)}</td>
                  <td>{t.weight}</td>
                  <td>{totalWeight ? Math.round((t.weight / totalWeight) * 100) + '%' : '—'}</td>
                  <td>{t.daily_cap}/{tr('installments.dayUnit')}</td>
                  <td>{(t.languages ?? []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
