// قسم مهمة المتابعة (التاسك) + أدوات الإشعار
// - جدولة/تنفيذ/إلغاء تاسك
// - "أجّل لبكرة": يخفي الإشعار حتى بداية اليوم التالي
// - "إيقاف/استئناف المتابعة": يوقف الإشعارات نهائيًا (قرار صريح)
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/format'

// مواعيد جاهزة — تغني عن فتح منتقي التاريخ في أغلب الحالات
const QUICK = [
  { label: 'اليوم',     icon: '🕐', hours: 3 },
  { label: 'بكرة',      icon: '🌅', hours: 24 },
  { label: 'بعد يومين', icon: '📅', hours: 48 },
  { label: 'بعد أسبوع', icon: '🗓', hours: 168 },
]

// الموعد الفعلي الذي سيُجدول — يُعرض على الزر ليعرف الموظف ما يختاره
function targetDate(hours) {
  const d = new Date()
  d.setHours(d.getHours() + hours)
  d.setMinutes(0, 0, 0)
  return d
}
const previewOf = (d) => {
  const day = d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function TaskSection({ leadId, leadOwnerId, onChanged }) {
  const { profile } = useAuth()
  const [task, setTask] = useState(null)
  const [lead, setLead] = useState(null)   // snooze_until, follow_paused
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState(false)   // إظهار الموعد المخصّص
  const [confirmStop, setConfirmStop] = useState(false)

  const load = useCallback(async () => {
    const [{ data: t }, { data: l }] = await Promise.all([
      supabase.from('tasks')
        .select('*, creator:profiles!tasks_created_by_fkey(full_name)')
        .eq('lead_id', leadId).eq('status', 'open')
        .order('due_at', { ascending: true }).limit(1),
      supabase.from('leads')
        .select('snooze_until, follow_paused').eq('id', leadId).single(),
    ])
    setTask(t?.[0] ?? null)
    setLead(l ?? null)
  }, [leadId])

  useEffect(() => { load() }, [load])

  async function addTask(whenIso) {
    const when = whenIso ?? (due ? new Date(due).toISOString() : null)
    if (!when) return
    setBusy(true)
    await supabase.from('tasks').insert({
      lead_id: leadId,
      assigned_to: leadOwnerId ?? profile.id,
      created_by: profile.id,
      due_at: when,
      note: note.trim() || null,
    })
    // جدولة تاسك تلغي أي تأجيل سابق
    await supabase.from('leads').update({ snooze_until: null }).eq('id', leadId)
    setDue(''); setNote(''); setCustom(false); setBusy(false)
    await load(); onChanged?.()
  }

  // موعد سريع: الساعة القادمة المضبوطة بعد N ساعة
  function quickSchedule(hours) {
    addTask(targetDate(hours).toISOString())
  }

  async function completeTask() {
    await supabase.from('tasks').update({
      status: 'done', done_at: new Date().toISOString(),
    }).eq('id', task.id)
    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'note',
      content: 'تم تنفيذ مهمة المتابعة' + (task.note ? `: ${task.note}` : ''),
    })
    await supabase.from('leads').update({
      last_activity: new Date().toISOString(), snooze_until: null,
    }).eq('id', leadId)
    await load(); onChanged?.()
  }

  async function cancelTask() {
    await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', task.id)
    await load(); onChanged?.()
  }

  // أجّل لبكرة: يخفي الإشعار حتى بداية اليوم التالي
  async function snoozeToTomorrow() {
    const t = new Date()
    t.setDate(t.getDate() + 1)
    t.setHours(0, 0, 0, 0)   // بداية اليوم التالي
    await supabase.from('leads').update({ snooze_until: t.toISOString() }).eq('id', leadId)
    await load(); onChanged?.()
  }

  // إيقاف المتابعة نهائيًا: يوقف الإشعارات + يقفل أي تاسك مفتوح
  async function pauseFollow() {
    await supabase.from('tasks').update({ status: 'cancelled' })
      .eq('lead_id', leadId).eq('status', 'open')
    await supabase.from('leads').update({ follow_paused: true, snooze_until: null }).eq('id', leadId)
    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'note', content: 'إيقاف المتابعة',
    })
    setConfirmStop(false)
    await load(); onChanged?.()
  }

  async function resumeFollow() {
    await supabase.from('leads').update({ follow_paused: false }).eq('id', leadId)
    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'note', content: 'استئناف المتابعة',
    })
    await load(); onChanged?.()
  }

  const overdue = task && new Date(task.due_at) < new Date()
  const snoozed = lead?.snooze_until && new Date(lead.snooze_until) > new Date()
  const paused = lead?.follow_paused

  // ---------- موقوفة ----------
  if (paused) {
    return (
      <div className="follow-card paused">
        <div className="follow-title">⏹ المتابعة موقوفة على هذا الملف</div>
        <p className="follow-sub">لن تظهر أي تنبيهات حتى تستأنفها</p>
        <button className="btn btn-primary btn-sm" onClick={resumeFollow}>▶ استئناف المتابعة</button>
      </div>
    )
  }

  // ---------- مهمة قائمة ----------
  if (task) {
    return (
      <div className={'follow-card ' + (overdue ? 'late' : 'active')}>
        <div className="follow-head">
          <span className="follow-title">
            {overdue ? '⚠ متابعة متأخرة' : '⏰ متابعة مجدولة'}
          </span>
          <span className="follow-when">{fmtDateTime(task.due_at)}</span>
        </div>

        {task.note && <div className="follow-note">{task.note}</div>}

        <div className="follow-actions">
          <button className="btn btn-primary" onClick={completeTask}>✓ تم التنفيذ</button>
          {!snoozed && (
            <button className="btn btn-ghost btn-sm" onClick={snoozeToTomorrow}>🌙 أجّل لبكرة</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={cancelTask}>إلغاء المهمة</button>
        </div>

        {snoozed && <div className="follow-sub">🌙 التنبيه مؤجّل حتى الغد</div>}
      </div>
    )
  }

  // ---------- لا توجد مهمة: جدولة ----------
  return (
    <div className="follow-card empty-state">
      <div className="follow-title">متى تتابع هذا العميل؟</div>

      <div className="quick-times">
        {QUICK.map(q => {
          const d = targetDate(q.hours)
          return (
            <button key={q.label} className="time-chip" disabled={busy}
              onClick={() => quickSchedule(q.hours)}
              title={`سيُجدول: ${previewOf(d)}`}>
              <b>{q.icon}</b>
              {q.label}
              <em>{previewOf(d)}</em>
            </button>
          )
        })}
        <button className={'time-chip alt' + (custom ? ' on' : '')}
          onClick={() => setCustom(v => !v)}>
          <b>⚙</b>
          موعد آخر
          <em>اختر بنفسك</em>
        </button>
      </div>

      {custom && (
        <div className="custom-time">
          <div className="field" style={{ marginBottom: 8 }}>
            <label>الموعد</label>
            <input type="datetime-local" value={due} min={toLocalInput(new Date())}
              onChange={e => setDue(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>ملاحظة (اختياري)</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="مثال: يتصل بعد استشارة زوجته" />
          </div>
          <button className="btn btn-primary" onClick={() => addTask()} disabled={busy || !due}>
            {busy ? 'جارٍ الحفظ…' : 'جدولة المتابعة'}
          </button>
        </div>
      )}

      {/* إجراء نهائي — مفصول ومميّز بصريًا */}
      <div className="danger-row">
        {!confirmStop ? (
          <button className="link-danger" onClick={() => setConfirmStop(true)}>
            ⏹ إيقاف المتابعة على هذا الملف
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              ستتوقف كل التنبيهات — متأكد؟
            </span>
            <button className="btn btn-danger btn-sm" onClick={pauseFollow}>نعم، أوقف</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmStop(false)}>تراجع</button>
          </div>
        )}
      </div>
    </div>
  )
}
