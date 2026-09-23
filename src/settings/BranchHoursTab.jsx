// ساعات عمل الفروع — لكل فرع: أيام العمل + بداية/نهاية + مدة الخانة.
// منها تتولّد خانات مواعيد المعاينات (شاشة المعاينات).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

// ترتيب الأسبوع سعوديًا (السبت أولًا). n = رقم اليوم بنظام JS: 0=الأحد .. 6=السبت
const DAYS = [
  { n: 6, ar: 'السبت' },
  { n: 0, ar: 'الأحد' },
  { n: 1, ar: 'الاثنين' },
  { n: 2, ar: 'الثلاثاء' },
  { n: 3, ar: 'الأربعاء' },
  { n: 4, ar: 'الخميس' },
  { n: 5, ar: 'الجمعة' },
]

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
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: branches }, { data: scheds }] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('branch_schedules').select('*'),
    ])
    const byBranch = Object.fromEntries((scheds ?? []).map(s => [s.branch_id, s]))
    setRows((branches ?? []).map(b => {
      const s = byBranch[b.id]
      return {
        branch_id: b.id,
        name: b.name,
        work_days: s?.work_days ?? [6, 0, 1, 2, 3, 4],   // افتراضي: السبت–الخميس
        start_time: hhmm(s?.start_time) || '16:00',
        end_time: hhmm(s?.end_time) || '20:00',
        slot_minutes: s?.slot_minutes ?? 30,
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

  async function save(id) {
    const r = rows.find(x => x.branch_id === id)
    if (!r) return
    if (r.end_time <= r.start_time) {
      setRows(rs => rs.map(x => x.branch_id === id ? { ...x, msg: { ok: false, t: 'وقت النهاية لازم يكون بعد البداية' } } : x))
      return
    }
    setRows(rs => rs.map(x => x.branch_id === id ? { ...x, saving: true, msg: null } : x))
    const { error } = await supabase.from('branch_schedules').upsert({
      branch_id: r.branch_id,
      work_days: r.work_days,
      start_time: r.start_time,
      end_time: r.end_time,
      slot_minutes: Number(r.slot_minutes),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' })
    setRows(rs => rs.map(x => x.branch_id === id
      ? { ...x, saving: false, dirty: error ? x.dirty : false, configured: !error || x.configured,
          msg: error ? { ok: false, t: 'تعذّر الحفظ' } : { ok: true, t: '✓ تم الحفظ' } }
      : x))
    if (!error) setTimeout(() =>
      setRows(rs => rs.map(x => x.branch_id === id ? { ...x, msg: null } : x)), 3000)
  }

  if (loading) return <div className="empty" style={{ padding: 24 }}>جارٍ التحميل…</div>
  if (!rows.length) return <div className="empty" style={{ padding: 24 }}>لا توجد فروع نشطة — أضِف فرعًا من تبويب «الفروع» أولًا.</div>

  return (
    <div>
      <p className="hint" style={{ marginBottom: 14 }}>
        اختر أيام العمل وساعاته لكل فرع، ومدة الخانة — ومنها تتولّد خانات مواعيد المعاينات تلقائيًا.
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
                  <span className="badge badge-pending" style={{ fontSize: 11 }}>غير مُعدّ بعد</span>
                )}
              </div>

              {/* أيام العمل */}
              <div className="row-label" style={{ marginBottom: 8 }}>أيام العمل</div>
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

              {/* الساعات + مدة الخانة */}
              <div className="grid-2">
                <div className="field">
                  <label>من</label>
                  <input type="time" value={r.start_time}
                    onChange={e => patch(r.branch_id, { start_time: e.target.value })} />
                </div>
                <div className="field">
                  <label>إلى</label>
                  <input type="time" value={r.end_time}
                    onChange={e => patch(r.branch_id, { end_time: e.target.value })} />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>مدة الخانة (دقيقة)</label>
                  <select value={r.slot_minutes}
                    onChange={e => patch(r.branch_id, { slot_minutes: e.target.value })}>
                    {SLOT_OPTIONS.map(m => <option key={m} value={m}>{m} دقيقة</option>)}
                  </select>
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {r.work_days.length
                      ? `${perDay} خانة في اليوم · ${r.work_days.length} أيام عمل`
                      : 'لم تُختَر أيام عمل'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                <button className="btn btn-primary" disabled={r.saving || !r.dirty} onClick={() => save(r.branch_id)}>
                  {r.saving ? 'جارٍ الحفظ…' : 'حفظ'}
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
