// قسم مهمة المتابعة (التاسك) + أدوات الإشعار
// - جدولة/تنفيذ/إلغاء تاسك
// - "أجّل لبكرة": يخفي الإشعار حتى بداية اليوم التالي
// - "إيقاف/استئناف المتابعة": يوقف الإشعارات نهائيًا (قرار صريح)
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/format'

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

  async function addTask() {
    if (!due) return
    setBusy(true)
    await supabase.from('tasks').insert({
      lead_id: leadId,
      assigned_to: leadOwnerId ?? profile.id,
      created_by: profile.id,
      due_at: new Date(due).toISOString(),
      note: note.trim() || null,
    })
    // جدولة تاسك تلغي أي تأجيل سابق
    await supabase.from('leads').update({ snooze_until: null }).eq('id', leadId)
    setDue(''); setNote(''); setBusy(false)
    await load(); onChanged?.()
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

  return (
    <div className="drawer-section">
      <h3>مهمة المتابعة</h3>

      {/* حالة موقوفة */}
      {paused ? (
        <div className="task-open" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⏹ المتابعة موقوفة</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
            لن تظهر أي تنبيهات على هذا الملف حتى تستأنف المتابعة
          </p>
          <button className="btn btn-primary" onClick={resumeFollow}>استئناف المتابعة</button>
        </div>
      ) : (
        <>
          {/* تاسك مفتوح */}
          {task ? (
            <div className="task-open" data-overdue={overdue}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {overdue ? '⚠ متابعة متأخرة' : '⏰ متابعة مجدولة'}
              </div>
              <div style={{ fontSize: 13, color: overdue ? 'var(--danger)' : 'var(--primary)', fontWeight: 600 }}>
                {fmtDateTime(task.due_at)}
              </div>
              {task.note && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--ink-soft)' }}>{task.note}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={completeTask}>تم التنفيذ</button>
                <button className="btn btn-ghost" onClick={cancelTask}>إلغاء المهمة</button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                حدّد موعد المتابعة القادم — سيختفي تنبيه الإهمال حتى يحين الموعد
              </p>
              <div className="field">
                <label>موعد المتابعة</label>
                <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
              </div>
              <div className="field">
                <label>ملاحظة (اختياري)</label>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="مثال: يتصل بعد استشارة زوجته" />
              </div>
              <button className="btn btn-primary" onClick={addTask} disabled={busy || !due}>
                {busy ? 'جارٍ الحفظ…' : 'جدولة المتابعة'}
              </button>
            </>
          )}

          {/* أدوات سريعة */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap',
            borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            {snoozed ? (
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                🌙 مؤجّل حتى الغد — لن يظهر تنبيه اليوم
              </span>
            ) : (
              <button className="btn btn-ghost" onClick={snoozeToTomorrow}>
                🌙 شفته — أجّل لبكرة
              </button>
            )}
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={pauseFollow}>
              ⏹ إيقاف المتابعة
            </button>
          </div>
        </>
      )}
    </div>
  )
}
