// ساعات عمل الفروع — لكل فرع: أيام العمل + بداية/نهاية (عامة أو لكل يوم) + مدة الخانة.
// منها تتولّد خانات مواعيد المعاينات (شاشة المعاينات).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import i18n from '../i18n'
import useT from '../i18n/useT'
import { dbName } from '../lib/lang'

// ترتيب الأسبوع سعوديًا (السبت أولًا). n = رقم اليوم بنظام JS: 0=الأحد .. 6=السبت
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]
// اسم اليوم بلغة الواجهة (2023-01-01 كان أحد)
const dayName = (n) => new Date(Date.UTC(2023, 0, 1 + n)).toLocaleDateString(
  i18n.language === 'en' ? 'en-GB' : 'ar', { weekday: 'long', timeZone: 'UTC' })
const DAYS = DAY_ORDER.map(n => ({ n, get ar() { return dayName(n) } }))

const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60]
const hhmm = (t) => (t ? String(t).slice(0, 5) : '')  // '16:00:00' → '16:00'

// عدد الخانات في اليوم من البداية/النهاية/المدة
function slotsPerDay(start, end, mins) {
  if (!start || !end || !mins) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const total = (eh * 60 + em) - (sh * 60 + sm)
  return total > 0 ? Math.floor(total / mins) : 0
}

export default function BranchHoursTab() {
  const { t } = useT()
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: branches }, { data: scheds }] = await Promise.all([
      supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name'),
      supabase.from('branch_schedules').select('*'),
    ])
    const byBranch = Object.fromEntries((scheds ?? []).map(s => [s.branch_id, s]))
    setRows((branches ?? []).map(b => {
      const s = byBranch[b.id]
      return {
        branch_id: b.id,
        name: dbName(b),
        work_days: s?.work_days ?? [6, 0, 1, 2, 3, 4],   // افتراضي: السبت–الخميس
        start_time: hhmm(s?.start_time) || '16:00',
        end_time: hhmm(s?.end_time) || '20:00',
        slot_minutes: s?.slot_minutes ?? 30,
        // ساعات خاصة لكل يوم: { '6': { start, end }, ... }
        per_day: Object.keys(s?.day_hours ?? {}).length > 0,
        day_hours: Object.fromEntries(Object.entries(s?.day_hours ?? {})
          .map(([k, v]) => [k, { start: hhmm(v.start), end: hhmm(v.end) }])),
        configured: !!s,
        dirty: false, saving: false, msg: null,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const patch = (id, changes) =>
    setRows(rs => rs.map(r => r.branch_id === id
      ? { ...r, ...changes, dirty: true, msg: null } : r))

  const toggleDay = (id, n) =>
    setRows(rs => rs.map(r => {
      if (r.branch_id !== id) return r
      const has = r.work_days.includes(n)
      return {
        ...r,
        work_days: has ? r.work_days.filter(d => d !== n) : [...r.work_days, n].sort((a, b) => a - b),
        dirty: true, msg: null,
      }
    }))

  // ساعات يوم معيّن (الخاصة لو مفعّلة، وإلا العامة)
  const hoursOf = (r, n) => (r.per_day && r.day_hours[n]) || { start: r.start_time, end: r.end_time }

  const patchDay = (id, n, changes) =>
    setRows(rs => rs.map(r => {
      if (r.branch_id !== id) return r
      const cur = hoursOf(r, n)
      return { ...r, day_hours: { ...r.day_hours, [n]: { ...cur, ...changes } }, dirty: true, msg: null }
    }))

  async function save(id) {
    const r = rows.find(x => x.branch_id === id)
    if (!r) return
    const fail = (t) => setRows(rs => rs.map(x => x.branch_id === id ? { ...x, msg: { ok: false, t } } : x))
    if (r.end_time <= r.start_time) return fail(t('hours.endAfterStart'))

    // ساعات الأيام: نحفظ بس أيام العمل، وكل يوم لازم نهايته بعد بدايته
    const day_hours = {}
    if (r.per_day) {
      for (const n of r.work_days) {
        const h = hoursOf(r, n)
        if (!h.start || !h.end || h.end <= h.start) {
          return fail(`${dayName(n)}: ${t('hours.endAfterStart')}`)
        }
        day_hours[n] = { start: h.start, end: h.end }
      }
    }
    setRows(rs => rs.map(x => x.branch_id === id ? { ...x, saving: true, msg: null } : x))
    const { error } = await supabase.from('branch_schedules').upsert({
      branch_id: r.branch_id,
      work_days: r.work_days,
      start_time: r.start_time,
      end_time: r.end_time,
      slot_minutes: Number(r.slot_minutes),
      day_hours,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' })
    setRows(rs => rs.map(x => x.branch_id === id
      ? { ...x, saving: false, dirty: error ? x.dirty : false, configured: !error || x.configured,
          msg: error ? { ok: false, t: t('addLead.saveFailed') } : { ok: true, t: '✓ ' + t('general.saved') } }
      : x))
    if (!error) setTimeout(() =>
      setRows(rs => rs.map(x => x.branch_id === id ? { ...x, msg: null } : x)), 3000)
  }

  if (loading) return <div className="empty" style={{ padding: 24 }}>{t('common.loading')}</div>
  if (!rows.length) return <div className="empty" style={{ padding: 24 }}>{t('hours.noBranches')}</div>

  return (
    <div>
      <p className="hint" style={{ marginBottom: 14 }}>
        {t('hours.intro')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map(r => {
          const perDay = slotsPerDay(r.start_time, r.end_time, Number(r.slot_minutes))
          return (
            <div key={r.branch_id} style={{
              border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--card)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{r.name}</h3>
                {!r.configured && (
                  <span className="badge badge-pending" style={{ fontSize: 11 }}>{t('hours.notConfigured')}</span>
                )}
              </div>

              {/* أيام العمل */}
              <div className="row-label" style={{ marginBottom: 8 }}>{t('hours.workDays')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {DAYS.map(d => {
                  const on = r.work_days.includes(d.n)
                  return (
                    <button key={d.n} onClick={() => toggleDay(r.branch_id, d.n)}
                      className="btn"
                      style={{
                        padding: '6px 12px', fontSize: 13, borderRadius: 20,
                        border: '1px solid ' + (on ? 'var(--primary)' : 'var(--line)'),
                        background: on ? 'var(--primary)' : 'transparent',
                        color: on ? '#fff' : 'var(--ink-soft)',
                      }}>
                      {d.ar}
                    </button>
                  )
                })}
              </div>

              {/* الساعات: عامة لكل الأيام أو مختلفة لكل يوم */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={r.per_day}
                  onChange={e => patch(r.branch_id, { per_day: e.target.checked })} />
                {t('hours.perDay')}
              </label>

              {r.per_day ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {DAYS.filter(d => r.work_days.includes(d.n)).map(d => {
                    const h = hoursOf(r, d.n)
                    const n = slotsPerDay(h.start, h.end, Number(r.slot_minutes))
                    return (
                      <div key={d.n} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 70px', gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontSize: 13.5 }}>{d.ar}</strong>
                        <input type="time" value={h.start} aria-label={`${d.ar} ${t('drawer.from')}`}
                          onChange={e => patchDay(r.branch_id, d.n, { start: e.target.value })} />
                        <input type="time" value={h.end} aria-label={`${d.ar} ${t('drawer.to')}`}
                          onChange={e => patchDay(r.branch_id, d.n, { end: e.target.value })} />
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{t('hours.nSlots', { n })}</span>
                      </div>
                    )
                  })}
                  {!r.work_days.length && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('hours.pickDaysFirst')}</div>}
                </div>
              ) : (
              <div className="grid-2">
                <div className="field">
                  <label>{t('drawer.from')}</label>
                  <input type="time" value={r.start_time}
                    onChange={e => patch(r.branch_id, { start_time: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('leads.f.to')}</label>
                  <input type="time" value={r.end_time}
                    onChange={e => patch(r.branch_id, { end_time: e.target.value })} />
                </div>
              </div>
              )}

              <div className="grid-2">
                <div className="field">
                  <label>{t('hours.slotMinutes')}</label>
                  <select value={r.slot_minutes}
                    onChange={e => patch(r.branch_id, { slot_minutes: e.target.value })}>
                    {SLOT_OPTIONS.map(m => <option key={m} value={m}>{t('hours.nMinutes', { n: m })}</option>)}
                  </select>
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {!r.work_days.length
                      ? t('hours.noDaysPicked')
                      : r.per_day
                        ? t('hours.weekSummary', { n: r.work_days.reduce((acc, n) => { const h = hoursOf(r, n); return acc + slotsPerDay(h.start, h.end, Number(r.slot_minutes)) }, 0), days: r.work_days.length })
                        : t('hours.daySummary', { n: perDay, days: r.work_days.length })}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                <button className="btn btn-primary" disabled={r.saving || !r.dirty} onClick={() => save(r.branch_id)}>
                  {r.saving ? t('common.saving') : t('common.save')}
                </button>
                {r.msg && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: r.msg.ok ? 'var(--ok)' : 'var(--danger)' }}>
                    {r.msg.t}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
