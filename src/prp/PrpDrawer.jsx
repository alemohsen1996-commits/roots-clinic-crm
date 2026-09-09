// اللوحة الجانبية لباقة البلازما
// إدارة كل جلسة (تمت / لم يحضر / إعادة جدولة) + تغيير عدد الجلسات + تسجيل انقطاع
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDate } from '../lib/format'
import ProgressDots from './ProgressDots'

const S_STATUS = {
  scheduled: { label: 'مجدولة',   cls: 'badge-pending' },
  done:      { label: 'تمت',      cls: 'badge-active' },
  missed:    { label: 'لم يحضر',  cls: 'badge-suspended' },
  cancelled: { label: 'ملغاة',    cls: 'badge-suspended' },
}

const today = () => new Date().toISOString().slice(0, 10)

export default function PrpDrawer({ packageId, onClose, onChanged }) {
  const { profile, isManager, roleCode } = useAuth()
  const [pkg, setPkg] = useState(null)
  const [sessions, setSessions] = useState([])
  const [doctors, setDoctors] = useState([])
  const [err, setErr] = useState('')
  const [dropping, setDropping] = useState(false)
  const [dropReason, setDropReason] = useState('')

  // تأكيد إتمام الجلسة بتاريخ يختاره المستخدم
  const [confirming, setConfirming] = useState(null)   // session id
  const [doneDate, setDoneDate] = useState(today())

  const load = useCallback(async () => {
    const [{ data: p }, { data: s }, { data: docs }] = await Promise.all([
      supabase.from('prp_packages')
        .select(`*, leads(file_no, full_name, phone),
                 deals(agent_id, coordinator_id,
                       agent:profiles!deals_agent_id_fkey(full_name),
                       coordinator:profiles!deals_coordinator_id_fkey(full_name))`)
        .eq('id', packageId).single(),
      supabase.from('prp_sessions')
        .select('*, doctors(full_name)')
        .eq('package_id', packageId)
        .order('session_no'),
      supabase.from('doctors').select('id, full_name').eq('is_active', true),
    ])
    setPkg(p)
    setSessions(s ?? [])
    setDoctors(docs ?? [])
  }, [packageId])

  useEffect(() => { load() }, [load])

  async function updateSession(id, patch) {
    const { error } = await supabase.from('prp_sessions').update(patch).eq('id', id)
    if (error) { setErr('تعذر التحديث'); return }
    setErr('')
    await load(); onChanged()
  }

  // فتح تأكيد الإتمام — التاريخ الافتراضي هو الموعد المخطط أو اليوم
  function startDone(s) {
    setErr('')
    setConfirming(s.id)
    setDoneDate(s.planned_date || today())
  }

  async function confirmDone(s) {
    if (!doneDate) { setErr('اختر تاريخ الجلسة'); return }
    if (doneDate > today()) { setErr('لا يمكن تسجيل جلسة بتاريخ مستقبلي'); return }
    setConfirming(null)
    await updateSession(s.id, {
      status: 'done',
      actual_date: doneDate,
      performed_by: profile.id,
    })
  }

  async function changeTotal(newTotal) {
    const n = Number(newTotal)
    if (!n || n < 1) { setErr('عدد غير صالح'); return }

    // أعلى رقم جلسة منجزة — لا يمكن النزول تحته
    const doneNos = sessions.filter(s => s.status === 'done').map(s => s.session_no)
    const highestDone = doneNos.length ? Math.max(...doneNos) : 0
    if (n < highestDone) {
      setErr(`لا يمكن أقل من ${highestDone} — توجد جلسة منجزة بهذا الرقم`)
      return
    }
    setErr('')

    await supabase.from('prp_packages').update({ sessions_total: n }).eq('id', packageId)

    const current = sessions.length
    if (n > current) {
      const last = sessions[sessions.length - 1]
      const base = last?.planned_date ? new Date(last.planned_date) : new Date()
      const extra = Array.from({ length: n - current }, (_, i) => {
        const d = new Date(base); d.setDate(d.getDate() + (i + 1) * 30)
        return { package_id: packageId, session_no: current + i + 1, planned_date: d.toISOString().slice(0, 10) }
      })
      await supabase.from('prp_sessions').insert(extra)
    } else if (n < current) {
      // تُحذف كل الجلسات غير المنجزة الزائدة — لا المجدولة فقط
      // (وإلا بقيت جلسات "لم يحضر" فيختل شريط التقدم)
      const removable = sessions
        .filter(s => s.session_no > n && s.status !== 'done')
        .map(s => s.id)
      if (removable.length) await supabase.from('prp_sessions').delete().in('id', removable)
    }
    await load(); onChanged()
  }

  async function dropPackage() {
    if (!dropReason.trim()) { setErr('اكتب سبب الانقطاع'); return }
    await supabase.from('prp_packages').update({
      status: 'dropped', dropped_reason: dropReason.trim(),
    }).eq('id', packageId)
    setDropping(false)
    await load(); onChanged()
  }

  async function reactivate() {
    await supabase.from('prp_packages').update({
      status: 'active', dropped_reason: null,
    }).eq('id', packageId)
    await load(); onChanged()
  }

  if (!pkg) return null
  const doneCount = sessions.filter(s => s.status === 'done').length

  // من يملك التعديل: المدير · موظف البلازما · منسقة الديل نفسها
  const canEdit = isManager
    || roleCode === 'prp_officer'
    || pkg.deals?.coordinator_id === profile?.id

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-soft)' }}>
              {pkg.leads?.file_no} · باقة #{pkg.id}
            </div>
            <h2>{pkg.leads?.full_name}</h2>
            <div dir="ltr" style={{ textAlign: 'right', color: 'var(--ink-soft)', fontSize: 13.5 }}>
              {pkg.leads?.phone}
            </div>
            <div style={{ marginTop: 8, fontSize: 18 }}>
              <ProgressDots done={doneCount} total={pkg.sessions_total} />
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </header>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="drawer-info" style={{ marginBottom: 12 }}>
          <div><span>المنسقة</span>{pkg.deals?.coordinator?.full_name ?? '—'}</div>
          <div><span>موظف المبيعات</span>{pkg.deals?.agent?.full_name ?? '—'}</div>
        </div>

        {!canEdit && (
          <div style={{
            fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--surface)',
            padding: '10px 14px', borderRadius: 8, marginBottom: 8, lineHeight: 1.7,
          }}>
            👁 هذا المريض تحت إدارة منسقة أخرى — يمكنك متابعة حالته فقط
          </div>
        )}
        {pkg.status === 'dropped' && (
          <div className="alert alert-error">
            باقة منقطعة — السبب: {pkg.dropped_reason ?? '—'}
            {canEdit && (
              <button className="btn btn-ghost" style={{ marginInlineStart: 10 }} onClick={reactivate}>
                إعادة تنشيط
              </button>
            )}
          </div>
        )}
        {pkg.status === 'completed' && (
          <div className="alert alert-ok">اكتملت كل جلسات الباقة 🎉</div>
        )}

        {/* عدد الجلسات المتعاقد عليها */}
        {pkg.status === 'active' && canEdit && (
          <div className="drawer-section">
            <h3>عدد جلسات الباقة</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {[2, 3, 4].map(n => (
                <button key={n}
                  className={'btn ' + (pkg.sessions_total === n ? 'btn-primary' : 'btn-ghost')}
                  onClick={() => changeTotal(n)}>
                  {n} جلسات
                </button>
              ))}
              <input type="number" min={1} max={12} defaultValue={pkg.sessions_total}
                onBlur={e => Number(e.target.value) !== pkg.sessions_total && changeTotal(e.target.value)}
                style={{ width: 70 }} title="عدد مخصص" />
            </div>
            <small style={{ color: 'var(--ink-soft)' }}>
              تقليل العدد يحذف الجلسات غير المنجزة الزائدة فقط
            </small>
          </div>
        )}

        {/* الجلسات */}
        <div className="drawer-section">
          <h3>الجلسات</h3>
          <div className="timeline">
            {sessions.map(s => (
              <div className="timeline-item" key={s.id}>
                <div className="timeline-meta">
                  <b>جلسة {s.session_no}</b>
                  <span className={'badge ' + S_STATUS[s.status]?.cls}>{S_STATUS[s.status]?.label}</span>
                  {s.doctors?.full_name && <span>{s.doctors.full_name}</span>}
                </div>
                <div className="timeline-body" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                  {s.status === 'done' ? (
                    <span>تمت في {fmtDate(s.actual_date)}</span>
                  ) : confirming === s.id ? (
                    <>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>تاريخ الجلسة الفعلي:</span>
                      <input type="date" value={doneDate} max={today()}
                        onChange={e => setDoneDate(e.target.value)}
                        style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'var(--font-body)' }} />
                      <button className="btn btn-primary" onClick={() => confirmDone(s)}>تأكيد</button>
                      <button className="btn btn-ghost" onClick={() => setConfirming(null)}>إلغاء</button>
                    </>
                  ) : (
                    <>
                      <input type="date" value={s.planned_date ?? ''} disabled={!canEdit}
                        onChange={e => updateSession(s.id, { planned_date: e.target.value })}
                        style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'var(--font-body)' }} />
                      <select value={s.doctor_id ?? ''} disabled={!canEdit}
                        onChange={e => updateSession(s.id, { doctor_id: e.target.value ? Number(e.target.value) : null })}
                        style={{ padding: '5px 8px' }}>
                        <option value="">الطبيب</option>
                        {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                      </select>
                      {s.status === 'scheduled' && pkg.status === 'active' && canEdit && (
                        <>
                          <button className="btn btn-primary" onClick={() => startDone(s)}>✓ تمت</button>
                          <button className="btn btn-ghost" onClick={() => updateSession(s.id, { status: 'missed' })}>
                            لم يحضر
                          </button>
                        </>
                      )}
                      {s.status === 'missed' && pkg.status === 'active' && canEdit && (
                        <>
                          <button className="btn btn-ghost" onClick={() => updateSession(s.id, { status: 'scheduled' })}>
                            إعادة جدولة
                          </button>
                          <button className="btn btn-primary" onClick={() => startDone(s)}>✓ حضر فعلًا</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* الانقطاع */}
        {pkg.status === 'active' && canEdit && (
          <div className="drawer-section">
            <h3>انقطاع المريض</h3>
            {!dropping ? (
              <button className="btn btn-danger" onClick={() => setDropping(true)}>
                تسجيل انقطاع عن الباقة
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input style={{ flex: 1, minWidth: 180 }} value={dropReason}
                  onChange={e => setDropReason(e.target.value)}
                  placeholder="سبب الانقطاع (سفر، عدم اقتناع…)" />
                <button className="btn btn-danger" onClick={dropPackage}>تأكيد</button>
                <button className="btn btn-ghost" onClick={() => setDropping(false)}>تراجع</button>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
