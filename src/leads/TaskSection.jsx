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
  { label: 'بكرة',      hours: 24 },
  { label: 'بعد يومين', hours: 48 },
  { label: 'بعد أسبوع', hours: 168 },
]

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
    setDue(''); setNote(''); setBusy(false)
    await load(); onChanged?.()
  }

  // موعد سريع: نفس التوقيت الحالي بعد N ساعة
  function quickSchedule(hours) {
    const d = new Date()
    d.setHours(d.getHours() + hours)
    d.setMinutes(0, 0, 0)
    addTask(d.toISOString())
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
      <div className="lead-block">
        <div className="task-open" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b>⏹ المتابعة موقوفة</b>
            <button className="btn btn-primary btn-sm" onClick={resumeFollow}>استئناف</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- مهمة قائمة ----------
  if (task) {
    return (
      <div className="lead-block">
        <div className="task-open" data-overdue={overdue}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13.5 }}>{overdue ? '⚠ متابعة متأخرة' : '⏰ متابعة مجدولة'}</b>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: overdue ? 'var(--danger)' : 'var(--primary)',
            }}>
              {fmtDateTime(task.due_at)}
            </span>
          </div>
          {task.note && (
            <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-soft)' }}>{task.note}</div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={completeTask}>✓ تم التنفيذ</button>
            <button className="btn btn-ghost btn-sm" onClick={cancelTask}>إلغاء المهمة</button>
            {!snoozed && (
              <button className="btn btn-ghost btn-sm" onClick={snoozeToTomorrow}>🌙 أجّل لبكرة</button>
            )}
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
              onClick={pauseFollow}>⏹ إيقاف</button>
          </div>
          {snoozed && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
              🌙 التنبيه مؤجّل حتى الغد
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- لا توجد مهمة: جدولة ----------
  return (
    <div className="lead-block">
      <div className="row-label">جدولة متابعة</div>

      {/* مواعيد بضغطة واحدة */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {QUICK.map(q => (
          <button key={q.label} className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => quickSchedule(q.hours)}>
            {q.label}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
          onClick={pauseFollow}>⏹ إيقاف المتابعة</button>
      </div>

      {/* موعد مخصّص */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}
          min={toLocalInput(new Date())} style={{ flex: '1 1 180px' }} />
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder="ملاحظة (اختياري)" style={{ flex: '1 1 180px' }} />
        <button className="btn btn-primary" onClick={() => addTask()} disabled={busy || !due}>
          {busy ? '…' : 'جدولة'}
        </button>
      </div>
    </div>
  )
}
