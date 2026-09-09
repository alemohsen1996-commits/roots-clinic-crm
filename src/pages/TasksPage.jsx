// مهامي اليوم — كل مهام المتابعة المستحقة (اليوم وما قبله) للمستخدم
// مقسّمة: متأخرة | اليوم — مع إجراءات سريعة بدون فتح الملف
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/format'
import LeadDrawer from '../leads/LeadDrawer'
import { useLeadRefs } from '../leads/useLeadRefs'

const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

export default function TasksPage() {
  const { profile, isManager } = useAuth()
  const refs = useLeadRefs()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [openLead, setOpenLead] = useState(null)
  const [scope, setScope] = useState('mine')   // mine | all (للمدير)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // المستحقة: موعدها ≤ نهاية اليوم
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)

    let q = supabase
      .from('tasks')
      .select(`
        id, due_at, note, assigned_to,
        leads(id, file_no, full_name, phone, stage_id, snooze_until, follow_paused,
              stages(name_ar, color)),
        assignee:profiles!tasks_assigned_to_fkey(full_name)
      `)
      .eq('status', 'open')
      .lte('due_at', endOfDay.toISOString())
      .order('due_at', { ascending: true })

    if (!(isManager && scope === 'all')) {
      q = q.eq('assigned_to', profile.id)
    }

    const { data } = await q
    setTasks(data ?? [])
    setLoading(false)
  }, [profile.id, isManager, scope])

  useEffect(() => { load() }, [load])

  // ---------- إجراءات سريعة (نفس منطق TaskSection) ----------
  async function completeTask(t) {
    setBusyId(t.id); setMsg('')
    await supabase.from('tasks').update({
      status: 'done', done_at: new Date().toISOString(),
    }).eq('id', t.id)
    await supabase.from('activities').insert({
      lead_id: t.leads.id, user_id: profile.id, type: 'note',
      content: 'تم تنفيذ مهمة المتابعة' + (t.note ? `: ${t.note}` : ''),
    })
    await supabase.from('leads').update({
      last_activity: new Date().toISOString(), snooze_until: null,
    }).eq('id', t.leads.id)
    setBusyId(null)
    setMsg(`تم تنفيذ متابعة ${t.leads.full_name}`)
    load()
  }

  // تأجيل المهمة نفسها ليوم آخر (وليس مجرد إخفاء التنبيه)
  async function postpone(t, days) {
    setBusyId(t.id); setMsg('')
    const d = new Date(t.due_at)
    d.setDate(d.getDate() + days)
    // لو الموعد الجديد ما زال في الماضي، اجعله غدًا صباحًا
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)
    const next = d < new Date() ? tomorrow : d

    await supabase.from('tasks').update({ due_at: next.toISOString() }).eq('id', t.id)
    setBusyId(null)
    setMsg(`تم تأجيل متابعة ${t.leads.full_name} إلى ${fmtDateTime(next.toISOString())}`)
    load()
  }

  // ---------- التقسيم ----------
  const now = new Date()
  const startOfToday = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const overdue = tasks.filter(t => new Date(t.due_at) < startOfToday)
  const todays  = tasks.filter(t => new Date(t.due_at) >= startOfToday)

  // ---------- صف واحد ----------
  function Row({ t, late }) {
    const isLate = new Date(t.due_at) < now
    const snoozed = t.leads?.snooze_until && new Date(t.leads.snooze_until) > now
    return (
      <tr key={t.id} style={{ opacity: busyId === t.id ? .5 : 1 }}>
        <td style={{ fontWeight: 600 }}>
          {t.leads?.full_name}
          <small style={{ color: 'var(--ink-soft)' }}> · {t.leads?.file_no}</small>
          {snoozed && (
            <span className="badge badge-pending" style={{ marginInlineStart: 6 }} title="التنبيه مؤجّل لكن المتابعة مستحقة">
              🌙 مؤجّل
            </span>
          )}
        </td>
        <td>
          <span className="badge" style={{
            background: (t.leads?.stages?.color ?? '#888') + '22',
            color: t.leads?.stages?.color ?? '#888',
          }}>
            {t.leads?.stages?.name_ar}
          </span>
        </td>
        <td style={{ color: isLate ? 'var(--danger)' : 'var(--ink)', fontWeight: isLate ? 700 : 500 }}>
          {isLate && '⚠ '}{fmtDateTime(t.due_at)}
        </td>
        <td style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{t.note ?? '—'}</td>
        {isManager && scope === 'all' && <td>{t.assignee?.full_name ?? '—'}</td>}
        <td>
          <div className="row-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a className="icon-btn" href={`tel:${t.leads?.phone}`} title="اتصال">☎</a>
            <a className="icon-btn" title="واتساب" target="_blank" rel="noreferrer"
              href={`https://wa.me/${waNumber(t.leads?.phone)}`}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
              </svg>
            </a>
            <button className="icon-btn" title="نسخ الرقم"
              onClick={() => navigator.clipboard?.writeText(t.leads?.phone ?? '')}>⧉</button>
            <button className="btn btn-primary btn-sm" disabled={busyId === t.id}
              onClick={() => completeTask(t)}>✓ تم</button>
            <button className="btn btn-ghost btn-sm" disabled={busyId === t.id}
              onClick={() => postpone(t, 1)} title="تأجيل يوم واحد">+١ يوم</button>
            <button className="btn btn-ghost btn-sm" disabled={busyId === t.id}
              onClick={() => postpone(t, 3)} title="تأجيل ٣ أيام">+٣</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpenLead(t.leads)}>الملف</button>
          </div>
        </td>
      </tr>
    )
  }

  const colSpan = isManager && scope === 'all' ? 6 : 5

  function Table({ list, title, tone }) {
    if (list.length === 0) return null
    return (
      <div className="card" style={{ marginBottom: 18, borderColor: tone, borderWidth: 1.5 }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h2 style={{ fontSize: 15, color: tone }}>{title} ({list.length.toLocaleString('en-US')})</h2>
        </div>
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>العميل</th><th>المرحلة</th><th>موعد المتابعة</th>
              <th>الملاحظة</th>{isManager && scope === 'all' && <th>المسؤول</th>}<th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {list.map(t => <Row key={t.id} t={t} />)}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>مهامي اليوم</h1>
          <div className="hint">
            {tasks.length.toLocaleString('en-US')} متابعة مستحقة
            {overdue.length > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                {' '}— منها {overdue.length.toLocaleString('en-US')} متأخرة
              </span>
            )}
          </div>
        </div>
        {isManager && (
          <div className="board-tabs">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>مهامي</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>الكل</button>
          </div>
        )}
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : tasks.length === 0 ? (
        <div className="card empty">
          <strong>لا مهام مستحقة اليوم 🎉</strong>
          كل متابعاتك تحت السيطرة
        </div>
      ) : (
        <>
          <Table list={overdue} title="⚠ متأخرة — تحتاج تصرّفًا فورًا" tone="var(--danger)" />
          <Table list={todays}  title="متابعات اليوم"                  tone="var(--primary)" />
        </>
      )}

      {openLead && (
        <LeadDrawer
          leadId={openLead.id}
          refs={refs}
          onClose={() => setOpenLead(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
