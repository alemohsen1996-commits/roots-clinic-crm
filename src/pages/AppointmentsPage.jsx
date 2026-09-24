// شاشة المعاينات — عرض يومي لكل فرع (يستبدل جدول الإكسيل)
// الخانات تُولّد من إعداد الفرع، والمحجوز من جدول appointments.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useLeadRefs } from '../leads/useLeadRefs'
import LeadDrawer from '../leads/LeadDrawer'
import { emitBoardPatch } from '../leads/boardBus'
import { STAGE } from '../lib/stageCodes'
import { useAuth } from '../auth/AuthContext'

const STATUS = {
  booked:      { ar: 'محجوز',   bg: 'var(--primary)', soft: true },
  attended:    { ar: 'حضر',     bg: 'var(--ok)' },
  no_show:     { ar: 'لم يحضر', bg: 'var(--danger)' },
  rescheduled: { ar: 'تأجّل',   bg: 'var(--warn)' },
  pending:     { ar: 'بدون موعد', bg: 'var(--ink-soft)' },
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : '')
const localYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayStr = () => localYMD(new Date())
const DOW_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function StatusBadge({ s }) {
  const cfg = STATUS[s] ?? STATUS.pending
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
      background: cfg.bg + (cfg.soft ? '18' : '22'), color: cfg.bg,
    }}>{cfg.ar}</span>
  )
}

// توليد كل خانات اليوم من إعداد الفرع (للعرض؛ المتاح يُحسب بمطابقة المحجوز)
function genSlots(sched, dateStr) {
  if (!sched) return []
  const dow = new Date(dateStr + 'T00:00:00').getDay()
  if (!(sched.work_days ?? []).includes(dow)) return []
  const [sh, sm] = hhmm(sched.start_time).split(':').map(Number)
  const [eh, em] = hhmm(sched.end_time).split(':').map(Number)
  const start = sh * 60 + sm, end = eh * 60 + em
  const out = []
  for (let m = start; m + sched.slot_minutes <= end; m += sched.slot_minutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`)
  }
  return out
}

export default function AppointmentsPage() {
  const refs = useLeadRefs()
  const stages = refs.stages
  const { profile, roleCode, isManager } = useAuth()
  const canAttend = isManager || roleCode === 'coordinator'   // حضر/لم يحضر: المنسقة/المدير فقط
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState(null)
  const [summary, setSummary] = useState({})   // لكل فرع: أقرب حجز + الأعداد
  const [date, setDate] = useState(todayStr())
  const [sched, setSched] = useState(null)
  const [appts, setAppts] = useState([])       // معاينات اليوم (لها وقت)
  const [pending, setPending] = useState([])   // بدون موعد لهذا الفرع
  const [loading, setLoading] = useState(true)
  const [openLead, setOpenLead] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [noteFor, setNoteFor] = useState(null)   // { id, action, appt } عند طلب ملاحظة
  const [noteText, setNoteText] = useState('')
  const [book, setBook] = useState(null)       // { apptId, date, time, slots }
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')   // بحث بالاسم/الرقم

  // مراحل المعاينة (أكواد ديناميكية — نطابقها بالاسم)
  const attendedStage = stages.find(s => s.name_ar === 'حضر المعاينة')
  const noShowStage   = stages.find(s => s.name_ar === 'لم يحضر المعاينة')
  const followupStage = stages.find(s => s.code === STAGE.FOLLOWUP)

  useEffect(() => {
    (async () => {
      const { data: br } = await supabase.from('branches')
        .select('id, name').eq('is_active', true).order('name')
      const list = br ?? []
      setBranches(list)

      // ملخّص: أقرب حجز قادم + أعداد المحجوز/بدون موعد لكل فرع
      const today = todayStr()
      const [{ data: up }, { data: pend }] = await Promise.all([
        supabase.from('v_appointments').select('branch_id, appt_date')
          .gte('appt_date', today).in('status', ['booked', 'attended']),
        supabase.from('v_appointments').select('branch_id')
          .is('appt_date', null).eq('status', 'pending'),
      ])
      const sum = {}
      list.forEach(b => { sum[b.id] = { upcoming: 0, pending: 0, nearest: null } })
      ;(up ?? []).forEach(r => {
        const x = sum[r.branch_id]; if (!x) return
        x.upcoming++
        if (!x.nearest || r.appt_date < x.nearest) x.nearest = r.appt_date
      })
      ;(pend ?? []).forEach(r => { if (sum[r.branch_id]) sum[r.branch_id].pending++ })
      setSummary(sum)

      // الافتراضي: الفرع صاحب أقرب حجز، واليوم = أقرب حجز له
      if (list.length) {
        const withNear = list.filter(b => sum[b.id]?.nearest)
          .sort((a, b) => sum[a.id].nearest.localeCompare(sum[b.id].nearest))
        const def = withNear[0] ?? list[0]
        setBranchId(prev => prev ?? def.id)
        if (sum[def.id]?.nearest) setDate(sum[def.id].nearest)
      }
    })()
  }, [])

  // اختيار فرع ينقلك لأقرب يوم فيه حجز
  const selectBranch = (bid) => {
    setBranchId(bid)
    const near = summary[bid]?.nearest
    if (near) setDate(near)
  }

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true); setErr('')
    const [{ data: sc }, { data: dayAppts }, { data: pend }] = await Promise.all([
      supabase.from('branch_schedules').select('*').eq('branch_id', branchId).maybeSingle(),
      supabase.from('v_appointments').select('*')
        .eq('branch_id', branchId).eq('appt_date', date),
      supabase.from('v_appointments').select('*')
        .eq('branch_id', branchId).eq('status', 'pending'),
    ])
    setSched(sc ?? null)
    setAppts(dayAppts ?? [])
    setPending(pend ?? [])
    setLoading(false)
  }, [branchId, date])

  useEffect(() => { load() }, [load])

  // خريطة الوقت → معاينة
  const byTime = Object.fromEntries(appts.filter(a => a.appt_time).map(a => [hhmm(a.appt_time), a]))
  const slots = genSlots(sched, date)

  async function setStatus(appt, newStatus, note) {
    setBusyId(appt.id); setErr('')
    const patch = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'pending') { patch.appt_date = null; patch.appt_time = null }
    if (note !== undefined) patch.coordinator_note = note
    const { error } = await supabase.from('appointments').update(patch).eq('id', appt.id)
    if (error) { setErr('تعذّر تحديث الحالة'); setBusyId(null); return }
    // مزامنة مرحلة الليد مع الحالة (يمكن التصحيح في أي وقت)
    const target = newStatus === 'attended' ? attendedStage
                 : newStatus === 'no_show'  ? noShowStage
                 : newStatus === 'booked'   ? followupStage
                 : null
    if (target) {
      await supabase.from('leads').update({ stage_id: target.id }).eq('id', appt.lead_id)
      emitBoardPatch({ refetch: [target.id] })
    }
    setBusyId(null)
    setNoteFor(null); setNoteText('')
    await load()
  }

  // حضر/لم يحضر يتطلبان ملاحظة — نفتح مربّع ملاحظة أولًا
  function askNote(appt, action) {
    setNoteFor({ id: appt.id, action, appt })
    setNoteText(appt.coordinator_note ?? '')
    setErr('')
  }
  function confirmNote() {
    if (!noteText.trim()) { setErr('الملاحظة مطلوبة قبل الحفظ'); return }
    setStatus(noteFor.appt, noteFor.action, noteText.trim())
  }

  // فتح واجهة حجز لمعاينة "بدون موعد"
  async function openBooking(appt) {
    setBook({ apptId: appt.id, date: date, time: '', slots: [] })
    const { data } = await supabase.rpc('available_slots', { p_branch_id: branchId, p_date: date })
    setBook(b => b && b.apptId === appt.id ? { ...b, slots: (data ?? []).map(r => r.slot) } : b)
  }
  async function refreshBookSlots(d) {
    const { data } = await supabase.rpc('available_slots', { p_branch_id: branchId, p_date: d })
    setBook(b => b ? { ...b, date: d, time: '', slots: (data ?? []).map(r => r.slot) } : b)
  }
  async function confirmBooking() {
    if (!book?.time) return
    setBusyId(book.apptId); setErr('')
    const { error } = await supabase.from('appointments').update({
      status: 'booked', appt_date: book.date, appt_time: book.time,
      updated_at: new Date().toISOString(),
    }).eq('id', book.apptId)
    setBusyId(null)
    if (error) {
      setErr(error.code === '23505' ? 'الخانة اتحجزت للتو — اختر وقت تاني' : 'تعذّر الحجز')
      refreshBookSlots(book.date)
      return
    }
    setBook(null)
    await load()
  }

  const branch = branches.find(b => b.id === branchId)
  const matchQ = (a) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return (a.patient_name || '').toLowerCase().includes(t)
        || (a.patient_phone || '').includes(t)
  }
  // السيلز يفتح/يؤجّل ليداته فقط؛ المدير والمنسقة للكل
  const mine = (a) => isManager || roleCode === 'coordinator' || a.owner_id === profile?.id

  return (
    <>
      <div className="page-head">
        <div>
          <h1>المعاينات</h1>
        </div>
      </div>

      {/* تبويبات الفروع */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0 14px', flexWrap: 'wrap' }}>
        {branches.map(b => {
          const cnt = (summary[b.id]?.upcoming ?? 0) + (summary[b.id]?.pending ?? 0)
          return (
            <button key={b.id} className={'branch-chip' + (b.id === branchId ? ' on' : '')}
              onClick={() => selectBranch(b.id)}>
              {b.name}
              {cnt > 0 && (
                <span style={{
                  marginInlineStart: 6, fontSize: 11, fontWeight: 700,
                  padding: '1px 7px', borderRadius: 20,
                  background: 'var(--primary)', color: '#fff',
                }}>{cnt}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* شريط اليوم */}
      <div className="day-nav">
        <button className="day-nav-btn" onClick={() => setDate(shiftDay(date, -1))} aria-label="اليوم السابق">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        <div className="day-nav-date">
          <span className="day-nav-dow">{DOW_AR[new Date(date + 'T00:00:00').getDay()]}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button className="day-nav-btn" onClick={() => setDate(shiftDay(date, +1))} aria-label="اليوم التالي">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <button className="btn btn-ghost day-today" onClick={() => setDate(todayStr())}>اليوم</button>
      </div>

      <div className="appt-search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث باسم المريض أو رقمه…" />
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {/* بدون موعد */}
      {pending.length > 0 && (
        <div className="drawer-section" style={{ marginBottom: 14 }}>
          <h3>بدون موعد — بانتظار الحجز ({pending.length})</h3>
          {pending.filter(matchQ).map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '8px 0', borderTop: '0.5px solid var(--line)',
            }}>
              {mine(a) ? (
                <button className="link-name" style={{ fontWeight: 600, background: 'none', border: 0, cursor: 'pointer', color: 'var(--primary)' }}
                  onClick={() => setOpenLead(a.lead_id)}>{a.patient_name}</button>
              ) : (
                <span style={{ fontWeight: 600 }}>{a.patient_name}</span>
              )}
              <span dir="ltr" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{a.patient_phone}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>المنسقة: {a.coordinator_name ?? '—'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>السيلز: {a.owner_name ?? '—'}</span>
              {mine(a) && (
                <button className="btn btn-primary" style={{ marginInlineStart: 'auto', padding: '5px 14px' }}
                  onClick={() => openBooking(a)}>احجز موعد</button>
              )}
            </div>
          ))}

          {book && (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--primary)', borderRadius: 10 }}>
              <div className="grid-2">
                <div className="field">
                  <label>اليوم</label>
                  <input type="date" value={book.date} onChange={e => refreshBookSlots(e.target.value)} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>الوقت المتاح</label>
                {!sched ? (
                  <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                    فرع «{branch?.name}» غير مُعدّ — اضبط ساعاته من الإعدادات ← ساعات الفروع
                  </div>
                ) : book.slots.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                    لا خانات متاحة في هذا اليوم (إجازة أو محجوز بالكامل)
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {book.slots.map(t => {
                      const on = book.time === t
                      return (
                        <button key={t} onClick={() => setBook(b => ({ ...b, time: t }))} className="btn"
                          style={{
                            padding: '5px 12px', fontSize: 13, borderRadius: 8,
                            border: '1px solid ' + (on ? 'var(--primary)' : 'var(--line)'),
                            background: on ? 'var(--primary)' : 'transparent', color: on ? '#fff' : 'var(--ink)',
                          }}>{hhmm(t)}</button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={!book.time || busyId} onClick={confirmBooking}>تأكيد الحجز</button>
                <button className="btn btn-ghost" onClick={() => setBook(null)}>إلغاء</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* جدول اليوم */}
      {loading ? (
        <div className="empty" style={{ padding: 24 }}>جارٍ التحميل…</div>
      ) : !sched ? (
        <div className="empty" style={{ padding: 24 }}>
          الفرع «{branch?.name}» غير مُعدّ بعد — اضبط ساعاته من الإعدادات ← ساعات الفروع.
        </div>
      ) : slots.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}>هذا اليوم إجازة لفرع «{branch?.name}».</div>
      ) : (
        <table className="table appt-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>الوقت</th>
              <th style={{ width: 150 }}>المريض</th>
              <th style={{ width: 145 }}>الرقم</th>
              <th style={{ width: 140 }}>المنسقة</th>
              <th style={{ width: 120 }}>السيلز</th>
              <th style={{ width: 210 }}>ملاحظات</th>
              <th style={{ width: 100 }}>الحالة</th>
              <th style={{ width: 220 }}>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {slots.map(t => {
              const a = byTime[hhmm(t)]
              if (q.trim() && (!a || !matchQ(a))) return null   // أثناء البحث: المطابق فقط
              if (!a) return (
                <tr key={t} style={{ color: 'var(--ink-soft)' }}>
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(t)}</td>
                  <td colSpan={6} style={{ fontSize: 12.5 }}>— خانة فارغة —</td>
                  <td></td>
                </tr>
              )
              const busy = busyId === a.id
              return (
                <tr key={t}>
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(t)}</td>
                  <td>
                    {mine(a) ? (
                      <button className="link-name" style={{ fontWeight: 600, background: 'none', border: 0, cursor: 'pointer', color: 'var(--primary)', padding: 0 }}
                        onClick={() => setOpenLead(a.lead_id)}>{a.patient_name}</button>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{a.patient_name}</span>
                    )}
                  </td>
                  <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{a.patient_phone}</td>
                  <td>{a.coordinator_name ?? '—'}</td>
                  <td>{a.owner_name ?? '—'}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {a.callcenter_note && <div>{a.callcenter_note}</div>}
                    {a.coordinator_note && <div style={{ color: 'var(--primary)', fontWeight: 500 }}>{a.coordinator_note}</div>}
                    {!a.callcenter_note && !a.coordinator_note && '—'}
                  </td>
                  <td><StatusBadge s={a.status} /></td>
                  <td>
                    {noteFor?.id === a.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
                        <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2}
                          placeholder={noteFor.action === 'attended' ? 'ملاحظة الحضور (مطلوبة)…' : 'سبب عدم الحضور (مطلوب)…'}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line)',
                                   borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: 12.5, resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-primary" disabled={busy} onClick={confirmNote}
                            style={{ padding: '4px 12px', fontSize: 12 }}>تأكيد</button>
                          <button className="btn btn-ghost" onClick={() => { setNoteFor(null); setNoteText(''); setErr('') }}
                            style={{ padding: '4px 10px', fontSize: 12 }}>إلغاء</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {canAttend && (
                          <button className="btn" disabled={busy} onClick={() => askNote(a, 'attended')}
                            style={{ padding: '5px 14px', fontSize: 12.5, color: 'var(--ok)', borderColor: 'var(--ok)',
                              ...(a.status === 'attended' ? { background: 'var(--ok)', color: '#fff' } : {}) }}>حضر</button>
                        )}
                        {canAttend && (
                          <button className="btn" disabled={busy} onClick={() => askNote(a, 'no_show')}
                            style={{ padding: '5px 14px', fontSize: 12.5, color: 'var(--danger)', borderColor: 'var(--danger)',
                              ...(a.status === 'no_show' ? { background: 'var(--danger)', color: '#fff' } : {}) }}>لم يحضر</button>
                        )}
                        {mine(a) && (
                          <button className="btn" disabled={busy} onClick={() => setStatus(a, 'pending')}
                            style={{ padding: '5px 14px', fontSize: 12.5, color: 'var(--warn)', borderColor: 'var(--warn)' }}>تأجّل</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {openLead && stages.length > 0 && (
        <LeadDrawer leadId={openLead}
          refs={refs}
          onClose={() => setOpenLead(null)}
          onChanged={load}
          siblings={[]} onNavigate={() => {}} />
      )}
    </>
  )
}

function shiftDay(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return localYMD(d)
}
