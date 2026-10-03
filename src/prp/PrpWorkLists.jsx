// قوايم شغل البلازما اليومية:
// 1) جلسات فات ميعادها (أو النهارده) ولسه ما اتسجلش حضور/غياب — حضر / ماحضرش بضغطة
// 2) قايمة المتابعة — مرضى محتاجين تواصل، وكل صف عليه الخطوة الجاية
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtNum, openWhatsApp, timeAgo } from '../lib/format'
import i18n from '../i18n'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

const todayRiyadh = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })

// نتائج التواصل (أكواد في الداتابيز) — الأسماء من prpFu.outcome.*
const OUTCOME = (o) => i18n.t(`prpFu.outcome.${o}`, { defaultValue: o })
// أسباب الانقطاع: القيمة المخزّنة عربي ثابت (بيانات مشتركة)، والعرض بلغة الموظف
const DROP_REASONS = [
  { v: 'سافر', k: 'travel' }, { v: 'مش مقتنع بالنتيجة', k: 'notConvinced' }, { v: 'ظروف مادية', k: 'financial' },
  { v: 'ظروف صحية', k: 'health' }, { v: 'بيعمل الجلسات برا', k: 'elsewhere' }, { v: 'أخرى', k: 'other' },
]

function reasonText(r) {
  const t = i18n.t
  const last = r.last_done ? ` · ${t('prpFu.lastAttended')} ${fmtDate(r.last_done)}` : ''
  if (r.reason === 'missed_twice') return t('prpFu.missedInRow', { n: fmtNum(r.misses_in_row) }) + last
  if (r.reason === 'stale') return t('prpFu.idleDays', { n: fmtNum(r.days_idle) }) + last
  if (r.reason === 'missed') return t('prpFu.missedNeedsDate', { n: fmtNum(r.next_session_no) })
  return t('prpFu.noDate', { n: fmtNum(r.next_session_no) })
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
  const { t } = useT()
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
    if (error) { setErr(t('prpFu.recordFailed') + ' — ' + dbErr(error.message)); return }
    onChanged()
  }

  return (
    <div className="card prp-list" style={{ borderColor: 'var(--danger)' }}>
      <div className="prp-list-head">
        <h2 style={{ color: 'var(--danger)' }}>{t('prpFu.unrecordedTitle')} ({fmtNum(rows.length)})</h2>
        <div className="hint">{t('prpFu.unrecordedHint')}</div>
      </div>
      {err && <div className="alert alert-error" style={{ margin: '0 16px 8px' }}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>{t('statements.patient')}</th><th>{t('prpFu.session')}</th><th>{t('prpFu.scheduledFor')}</th><th>{t('lead.coordShort')}</th><th style={{ width: 210 }}></th></tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const allowed = canAct.can(r)
              return (
                <tr key={r.session_id}>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td>{t('prpFu.sessionOf', { n: fmtNum(r.session_no), total: fmtNum(r.sessions_total) })}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(r.planned_date)}{' '}
                    <span className={'badge ' + (r.days_late > 0 ? 'badge-suspended' : 'badge-pending')}>
                      {r.days_late > 0 ? t('deals.daysAgo', { n: fmtNum(r.days_late) }) : t('deals.today')}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{r.coordinator_name ?? '—'}</td>
                  <td>
                    {allowed ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy === r.session_id}
                          onClick={() => mark(r, 'done')}>✓ {t('apptStatus.attended')}</button>
                        <button className="btn btn-ghost btn-sm" disabled={busy === r.session_id}
                          onClick={() => mark(r, 'missed')}>{t('sessionStatus.missed')}</button>
                      </div>
                    ) : <span className="hint">{t('prpFu.otherCoord')}</span>}
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
  const { t } = useT()
  const [mode, setMode] = useState(null)        // { id, kind: 'book'|'contact'|'drop' }
  const [date, setDate] = useState('')
  const [dropReason, setDropReason] = useState(DROP_REASONS[0].v)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const { profile } = canAct
  if (!rows.length) return null

  const open = (id, kind) => {
    setErr(''); setMode({ id, kind })
    if (kind === 'book') setDate(todayRiyadh())
    if (kind === 'drop') setDropReason(DROP_REASONS[0].v)
  }
  const close = () => setMode(null)

  async function logContact(r, outcome) {
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.from('prp_followups')
      .insert({ package_id: r.package_id, outcome, created_by: profile?.id })
    setBusy(null)
    if (error) { setErr(t('prpFu.contactFailed') + ' — ' + dbErr(error.message)); return false }
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
    if (!date || date < todayRiyadh()) { setErr(t('prpFu.pickTodayOrLater')); return }
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.rpc('prp_book_next_session', { p_package_id: r.package_id, p_date: date })
    setBusy(null)
    if (error) { setErr(t('appts.bookFailed') + ' — ' + dbErr(error.message)); return }
    close(); onChanged()
  }

  async function drop(r) {
    setBusy(r.package_id); setErr('')
    const { error } = await supabase.from('prp_packages')
      .update({ status: 'dropped', dropped_reason: dropReason }).eq('id', r.package_id)
    setBusy(null)
    if (error) { setErr(t('prpFu.recordFailed') + ' — ' + dbErr(error.message)); return }
    close(); onChanged()
  }

  return (
    <div className="card prp-list" style={{ borderColor: 'var(--warn)' }}>
      <div className="prp-list-head">
        <h2 style={{ color: 'var(--warn)' }}>{t('prpFu.followupTitle')} ({fmtNum(rows.length)})</h2>
        <div className="hint">
          {t('prpFu.followupHint')}
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
                    {t('prpFu.sessionOf', { n: fmtNum(r.sessions_done), total: fmtNum(r.sessions_total) })} · {t('prpFu.left', { n: fmtNum(left) })}
                    {r.branch_name ? ` · ${r.branch_name}` : ''}
                  </span>
                </div>
                <div className={'prp-fu-reason tone-' + (r.reason === 'missed_twice' || r.reason === 'stale' ? 'danger' : 'warn')}>
                  {reasonText(r)}
                </div>
                <div className="deals-sub">
                  {t('prpFu.lastContact')}: {r.last_contact_at
                    ? `${timeAgo(r.last_contact_at)} — ${OUTCOME(r.last_outcome)}${r.last_contact_by ? ` (${r.last_contact_by})` : ''}`
                    : t('prpFu.noContactYet')}
                </div>
              </div>

              {allowed ? (
                <div className="prp-fu-actions">
                  {!isOpen && (
                    <>
                      <button className="btn btn-primary btn-sm" disabled={!r.phone || busy === r.package_id}
                        onClick={() => whatsapp(r)}>WhatsApp</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => open(r.package_id, 'book')}>{t('prpFu.bookSession')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => open(r.package_id, 'contact')}>{t('prpFu.contacted')}</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => open(r.package_id, 'drop')}>{t('prpFu.droppedForGood')}</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'book' && (
                    <>
                      <label className="prp-inline">
                        <span>{t('prpFu.sessionDateN', { n: fmtNum(r.next_session_no) })}</span>
                        <input type="date" value={date} min={todayRiyadh()} onChange={e => setDate(e.target.value)} />
                      </label>
                      <button className="btn btn-primary btn-sm" disabled={busy === r.package_id} onClick={() => book(r)}>{t('prpFu.book')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={close}>{t('common.back')}</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'contact' && (
                    <>
                      {['will_book', 'no_answer', 'not_interested'].map(o => (
                        <button key={o} className="btn btn-ghost btn-sm" disabled={busy === r.package_id}
                          onClick={() => contact(r, o)}>{OUTCOME(o)}</button>
                      ))}
                      <button className="btn btn-ghost btn-sm" onClick={close}>{t('common.back')}</button>
                    </>
                  )}

                  {isOpen && mode.kind === 'drop' && (
                    <>
                      <label className="prp-inline">
                        <span>{t('prpFu.reason')}</span>
                        <select value={dropReason} onChange={e => setDropReason(e.target.value)}>
                          {DROP_REASONS.map(x => <option key={x.v} value={x.v}>{t(`prpFu.drop.${x.k}`)}</option>)}
                        </select>
                      </label>
                      <button className="btn btn-danger btn-sm" disabled={busy === r.package_id} onClick={() => drop(r)}>{t('prpFu.confirmDrop')}</button>
                      <button className="btn btn-ghost btn-sm" onClick={close}>{t('common.back')}</button>
                    </>
                  )}
                </div>
              ) : (
                <span className="hint">{t('prpFu.otherCoord')}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
