// شاشة المعاينات — عرض يومي لكل فرع (يستبدل جدول الإكسيل)
// الخانات تُولّد من إعداد الفرع، والمحجوز من جدول appointments.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useLeadRefs } from '../leads/useLeadRefs'
import LeadDrawer from '../leads/LeadDrawer'
import { emitBoardPatch } from '../leads/boardBus'

const STATUS = {
  booked:      { ar: 'محجوز',   bg: 'var(--primary)', soft: true },
  attended:    { ar: 'حضر',     bg: 'var(--ok)' },
  no_show:     { ar: 'لم يحضر', bg: 'var(--danger)' },
  rescheduled: { ar: 'تأجّل',   bg: 'var(--warn)' },
  pending:     { ar: 'بدون موعد', bg: 'var(--ink-soft)' },
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : '')
const todayStr = () => new Date().toISOString().slice(0, 10)
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
  const [book, setBook] = useState(null)       // { apptId, date, time, slots }
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')   // بحث بالاسم/الرقم

  // مراحل المعاينة (أكواد ديناميكية — نطابقها بالاسم)
  const attendedStage = stages.find(s => s.name_ar === 'حضر المعاينة')
  const noShowStage   = stages.find(s => s.name_ar === 'لم يحضر المعاينة')

  useEffect(() => {
    (async () => {
      const { data: br } = await supabase.from('branches')
        .select('id, name').eq('is_active', true).order('name')
      const list = br ?? []
      setBranches(list)

      // ملخّص: أقرب حجز قادم + أعداد المحجوز/بدون موعد لكل فرع
      const today = todayStr()
      const [{ data: up }, { data: pend }] = await Promise.all([
        supabase.from('appointments').select('branch_id, appt_date')
          .gte('appt_date', today).in('status', ['booked', 'attended']),
        supabase.from('appointments').select('branch_id')
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
      supabase.from('appointments')
        .select('*, leads(id, full_name, phone, owner:profiles!leads_owner_id_fkey(full_name)), coordinator:profiles!appointments_coordinator_id_fkey(full_name)')
        .eq('branch_id', branchId).eq('appt_date', date),
      supabase.from('appointments')
        .select('*, leads(id, full_name, phone, owner:profiles!leads_owner_id_fkey(full_name)), coordinator:profiles!appointments_coordinator_id_fkey(full_name)')
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

  async function setStatus(appt, newStatus) {
    setBusyId(appt.id); setErr('')
    const patch = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'pending') { patch.appt_date = null; patch.appt_time = null }
    const { error } = await supabase.from('appointments').update(patch).eq('id', appt.id)
    if (!error) {
      // مزامنة مرحلة الليد
      const target = newStatus === 'attended' ? attendedStage
                   : newStatus === 'no_show'  ? noShowStage : null
      if (target) {
        await supabase.from('leads').update({ stage_id: target.id }).eq('id', appt.lead_id)
        emitBoardPatch({ refetch: [target.id] })
      }
    } else setErr('تعذّر تحديث الحالة')
    setBusyId(null)
    await load()
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
    return (a.leads?.full_name || '').toLowerCase().includes(t)
        || (a.leads?.phone || '').includes(t)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>المعاينات</h1>
          <div className="hint">جدول مواعيد المعاينات لكل فرع — يستبدل جدول الإكسيل</div>
        </div>
      </div>

      {/* تبويبات الفروع */}
      <div className="tabs" style={{ overflowX: 'auto' }}>
        {branches.map(b => {
          const cnt = (summary[b.id]?.upcoming ?? 0) + (summary[b.id]?.pending ?? 0)
          return (
            <button key={b.id} className={'tab' + (b.id === branchId ? ' on' : '')}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
        <button className="btn btn-ghost" onClick={() => setDate(shiftDay(date, -1))}>→ السابق</button>
        <div style={{ textAlign: 'center', minWidth: 190 }}>
          <div style={{ fontWeight: 600 }}>{DOW_AR[new Date(date + 'T00:00:00').getDay()]}</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ marginTop: 4, textAlign: 'center' }} />
        </div>
        <button className="btn btn-ghost" onClick={() => setDate(shiftDay(date, +1))}>التالي ←</button>
        <button className="btn btn-ghost" style={{ marginInlineStart: 'auto' }}
          onClick={() => setDate(todayStr())}>اليوم</button>
      </div>

      <div style={{ margin: '0 0 12px' }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="بحث باسم المريض أو رقمه…" style={{ width: '100%', maxWidth: 360 }} />
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
              <button className="link-name" style={{ fontWeight: 600, background: 'none', border: 0, cursor: 'pointer', color: 'var(--primary)' }}
                onClick={() => setOpenLead(a.lead_id)}>{a.leads?.full_name}</button>
              <span dir="ltr" style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{a.leads?.phone}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>المنسقة: {a.coordinator?.full_name ?? '—'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>السيلز: {a.leads?.owner?.full_name ?? '—'}</span>
              <button className="btn btn-primary" style={{ marginInlineStart: 'auto', padding: '5px 14px' }}
                onClick={() => openBooking(a)}>احجز موعد</button>
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
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>الوقت</th>
              <th>المريض</th>
              <th style={{ width: 120 }}>الرقم</th>
              <th style={{ whiteSpace: 'nowrap' }}>المنسقة</th>
              <th style={{ whiteSpace: 'nowrap' }}>السيلز</th>
              <th>ملاحظات الكول سنتر</th>
              <th style={{ width: 90 }}>الحالة</th>
              <th style={{ width: 200 }}>إجراء</th>
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
                    <button className="link-name" style={{ fontWeight: 600, background: 'none', border: 0, cursor: 'pointer', color: 'var(--primary)', padding: 0 }}
                      onClick={() => setOpenLead(a.lead_id)}>{a.leads?.full_name}</button>
                  </td>
                  <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{a.leads?.phone}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{a.coordinator?.full_name ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{a.leads?.owner?.full_name ?? '—'}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{a.callcenter_note ?? '—'}</td>
                  <td><StatusBadge s={a.status} /></td>
                  <td>
                    {(a.status === 'booked') && (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn" disabled={busy} onClick={() => setStatus(a, 'attended')}
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--ok)', borderColor: 'var(--ok)' }}>حضر</button>
                        <button className="btn" disabled={busy} onClick={() => setStatus(a, 'no_show')}
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--danger)', borderColor: 'var(--danger)' }}>لم يحضر</button>
                        <button className="btn" disabled={busy} onClick={() => setStatus(a, 'pending')}
                          style={{ padding: '4px 10px', fontSize: 12, color: 'var(--warn)', borderColor: 'var(--warn)' }}>تأجّل</button>
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
  return d.toISOString().slice(0, 10)
}
