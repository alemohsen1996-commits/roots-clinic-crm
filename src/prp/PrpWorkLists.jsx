// قوايم شغل البلازما اليومية:
// 1) جلسات فات ميعادها (أو النهارده) ولسه ما اتسجلش حضور/غياب — حضر / ماحضرش بضغطة
// 2) قايمة المتابعة — مرضى محتاجين تواصل، وكل صف عليه الخطوة الجاية
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtNum, openWhatsApp, timeAgo } from '../lib/format'

const todayRiyadh = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })

const OUTCOME = {
  wa_sent:        'اتبعتله واتساب',
  will_book:      'رد وهيحجز',
  no_answer:      'مردش',
  not_interested: 'مش مهتم دلوقتي',
}
const DROP_REASONS = ['سافر', 'مش مقتنع بالنتيجة', 'ظروف مادية', 'ظروف صحية', 'بيعمل الجلسات برا', 'أخرى']

function reasonText(r) {
  if (r.reason === 'missed_twice') {
    return `فوّت ${fmtNum(r.misses_in_row)} جلسات ورا بعض` + (r.last_done ? ` · آخر حضور ${fmtDate(r.last_done)}` : '')
  }
  if (r.reason === 'stale') {
    return `عدّى ${fmtNum(r.days_idle)} يوم من غير جلسة` + (r.last_done ? ` · آخر حضور ${fmtDate(r.last_done)}` : '')
  }
  if (r.reason === 'missed') return `ماحضرش جلسة ${fmtNum(r.next_session_no)} ومحتاج ميعاد جديد`
  return `جلسة ${fmtNum(r.next_session_no)} مالهاش ميعاد`
}

function waMessage(r) {
  const first = (r.full_name ?? '').trim().split(/\s+/)[0] || ''
  const left = Math.max(0, Number(r.sessions_total) - Number(r.sessions_done))
  const sessions = left === 1 ? 'جلسة بلازما واحدة' : left === 2 ? 'جلستين بلازما' : `${left} جلسات بلازما`
  return `أهلًا ${first}، وحشتنا 🌿\nفاضل لك ${sessions} ضمن باقتك في روتس كلينك.\n`
    + `تحب نحجزلك ميعاد${r.branch_name ? ` في فرع ${r.branch_name}` : ''}؟`
}

// ---------- جلسات متسجلتش ----------
export function UnrecordedSessions({ rows, canAct, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const { profile } = canAct
  if (!rows.length) return null

  async function mark(r, status) {
    setBusy(r.session_id); setErr('')
    // الحضور بتاريخ الميعاد نفسه (مش بعد بكره)، وباسم اللي سجّل
    const patch = status === 'done'
      ? { status, actual_date: r.planned_date <= todayRiyadh() ? r.planned_date : todayRiyadh(), performed_by: profile?.id }
      : { status }
    const { error } = await supabase.from('prp_sessions').update(patch).eq('id', r.session_id)
    setBusy(null)
    if (error) { setErr('تعذر التسجيل — ' + error.message); return }
    onChanged()
  }

  return (
    <div className="card prp-list" style={{ borderColor: 'var(--danger)' }}>
      <div className="prp-list-head">
        <h2 style={{ color: 'var(--danger)' }}>جلسات فات ميعادها ولسه متسجلتش ({fmtNum(rows.length)})</h2>
        <div className="hint">سجّل كل جلسة: حضر ولا ماحضرش — من غيرها أرقام البلازما مش هتطلع صح</div>
      </div>
      {err && <div className="alert alert-error" style={{ margin: '0 16px 8px' }}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>المريض</th><th>الجلسة</th><th>ميعادها</th><th>المنسقة</th><th style={{ width: 210 }}></th></tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const allowed = canAct.can(r)
              return (
                <tr key={r.session_id}>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td>جلسة {fmtNum(r.session_no)} من {fmtNum(r.sessions_total)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(r.planned_date)}{' '}
                    <span className={'badge ' + (r.days_late > 0 ? 'badge-suspended' : 'badge-pending')}>
                      {r.days_late > 0 ? `من ${fmtNum(r.days_late)} يوم` : 'النهارده'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{r.coordinator_name ?? '—'}</td>
                  <td>
                    {allowed ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy === r.session_id}
                          onClick={() => mark(r, 'done')}>✓ حضر</button>
                        <button className="btn btn-ghost btn-sm" disabled={busy === r.session_id}
                          onClick={() => mark(r, 'missed')}>ماحضرش</button>
                      </div>
                    ) : <span className="hint">منسقة تانية</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- قايمة المتابعة ----------
export function FollowupList({ rows, canAct, onChanged, onOpen }) {
  const [mode, setMode] = useState(null)        // { id, kind: 'book'|'contact'|'drop' }
  const [date, setDate] = useState('')
  const [dropReason, setDropReason] = useState(DROP_REASONS[0])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const { profile } = canAct
  if (!rows.length) return null

  const open = (id, kind) => {
    setErr(''); setMode({ id, kind })
    if (kind === 'book') setDate(todayRiyadh())
    if (kind === 'drop') setDropReason(DROP_REASONS[0])
  }
  const close = () => setMode(null)

  async function logContact(r, outcome) {
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.from('prp_followups')
      .insert({ package_id: r.package_id, outcome, created_by: profile?.id })
    setBusy(null)
    if (error) { setErr('تعذر تسجيل التواصل — ' + error.message); return false }
    return true
  }

  async function whatsapp(r) {
    openWhatsApp(r.phone, waMessage(r))
    if (await logContact(r, 'wa_sent')) onChanged()
  }

  async function contact(r, outcome) {
    if (await logContact(r, outcome)) { close(); onChanged() }
  }

  async function book(r) {
    if (!date || date < todayRiyadh()) { setErr('اختر تاريخ النهارده أو بعده'); return }
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.rpc('prp_book_next_session', { p_package_id: r.package_id, p_date: date })
    setBusy(null)
    if (error) { setErr('تعذر الحجز — ' + error.message); return }
    close(); onChanged()
  }

  async function drop(r) {
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.from('prp_packages')
      .update({ status: 'dropped', dropped_reason: dropReason }).eq('id', r.package_id)
    setBusy(null)
    if (error) { setErr('تعذر التسجيل — ' + error.message); return }
    close(); onChanged()
  }

  return (
    <div className="card prp-list" style={{ borderColor: 'var(--warn)' }}>
      <div className="prp-list-head">
        <h2 style={{ color: 'var(--warn)' }}>قايمة المتابعة ({fmtNum(rows.length)})</h2>
        <div className="hint">
          مرضى محتاجين تواصل — المريض بيخرج من القايمة لما يتحجزله ميعاد أو يتسجل منقطع،
          وبعد التواصل بيرجع لوحده لو محصلش حجز
        </div>
      </div>
      {err && <div className="alert alert-error" style={{ margin: '0 16px 8px' }}>{err}</div>}

      <div className="prp-followups">
        {rows.map(r => {
          const allowed = canAct.can(r)
          const isOpen = mode?.id === r.package_id
          const left = Math.max(0, Number(r.sessions_total) - Number(r.sessions_done))
          return (
            <div key={r.package_id} className="prp-fu-row">
              <div className="prp-fu-main">
                <div className="prp-fu-title">
                  <button type="button" className="link-btn" onClick={() => onOpen(r)}>{r.full_name}</button>
                  <span className="deals-sub" style={{ marginTop: 0 }}>
                    جلسة {fmtNum(r.sessions_done)} من {fmtNum(r.sessions_total)} · فاضل {fmtNum(left)}
                    {r.branch_name ? ` · ${r.branch_name}` : ''}
                  </span>
                </div>
                <div className={'prp-fu-reason tone-' + (r.reason === 'missed_twice' || r.reason === 'stale' ? 'danger' : 'warn')}>
                  {reasonText(r)}
                </div>
                <div className="deals-sub">
                  آخر تواصل: {r.last_contact_at
                    ? `${timeAgo(r.last_contact_at)} — ${OUTCOME[r.last_outcome] ?? r.last_outcome}${r.last_contact_by ? ` (${r.last_contact_by})` : ''}`
                    : 'لسه محدش اتواصل'}
                </div>
              </div>

              {allowed ? (
                <div className="prp-fu-actions">
                  {!isOpen && (
                    <>
                      <button className="btn btn-primary btn-sm" disabled={!r.phone || busy === r.package_id}
                        onClick={() => whatsapp(r)}>واتساب</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => open(r.package_id, 'book')}>احجز جلسة</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => open(r.package_id, 'contact')}>اتواصلت</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => open(r.package_id, 'drop')}>انقطع نهائي</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'book' && (
                    <>
                      <label className="prp-inline">
                        <span>ميعاد جلسة {fmtNum(r.next_session_no)}</span>
                        <input type="date" value={date} min={todayRiyadh()} onChange={e => setDate(e.target.value)} />
                      </label>
                      <button className="btn btn-primary btn-sm" disabled={busy === r.package_id} onClick={() => book(r)}>حجز</button>
                      <button className="btn btn-ghost btn-sm" onClick={close}>رجوع</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'contact' && (
                    <>
                      {['will_book', 'no_answer', 'not_interested'].map(o => (
                        <button key={o} className="btn btn-ghost btn-sm" disabled={busy === r.package_id}
                          onClick={() => contact(r, o)}>{OUTCOME[o]}</button>
                      ))}
                      <button className="btn btn-ghost btn-sm" onClick={close}>رجوع</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'drop' && (
                    <>
                      <label className="prp-inline">
                        <span>السبب</span>
                        <select value={dropReason} onChange={e => setDropReason(e.target.value)}>
                          {DROP_REASONS.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </label>
                      <button className="btn btn-danger btn-sm" disabled={busy === r.package_id} onClick={() => drop(r)}>تأكيد الانقطاع</button>
                      <button className="btn btn-ghost btn-sm" onClick={close}>رجوع</button>
                    </>
                  )}
                </div>
              ) : (
                <span className="hint">منسقة تانية</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
