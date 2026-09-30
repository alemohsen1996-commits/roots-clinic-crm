// محادثة جديدة: فردية مع أي موظف — أو جروب (للمديرين)
import { useEffect, useMemo, useState } from 'react'
import { createGroup, errText, fetchEmployees, startDirect } from './chatApi'
import LeadPicker from './LeadPicker'

export default function NewChatModal({ meId, canGroup, onClose, onOpened }) {
  const [mode, setMode] = useState('direct')
  const [people, setPeople] = useState([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([])
  const [title, setTitle] = useState('')
  const [lead, setLead] = useState(null)
  const [pickLead, setPickLead] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchEmployees().then(list => setPeople(list.filter(p => p.id !== meId))).catch(e => setErr(errText(e)))
  }, [meId])

  const shown = useMemo(() => {
    const s = q.trim()
    return s ? people.filter(p => p.full_name?.includes(s) || p.roles?.name_ar?.includes(s)) : people
  }, [people, q])

  const openDirect = async (id) => {
    setBusy(true); setErr('')
    try { onOpened(await startDirect(id)) } catch (e) { setErr(errText(e)); setBusy(false) }
  }

  const saveGroup = async () => {
    if (!title.trim()) return setErr('اكتب اسم الجروب')
    if (!picked.length) return setErr('اختار عضو واحد على الأقل')
    setBusy(true); setErr('')
    try { onOpened(await createGroup(title.trim(), picked, lead?.id ?? null)) }
    catch (e) { setErr(errText(e)); setBusy(false) }
  }

  const toggle = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal chat-modal" onClick={e => e.stopPropagation()}>
        <h2>محادثة جديدة</h2>
        {canGroup && (
          <div className="tabs" style={{ marginBottom: 14 }}>
            <button className={'tab' + (mode === 'direct' ? ' on' : '')} onClick={() => setMode('direct')}>فردية</button>
            <button className={'tab' + (mode === 'group' ? ' on' : '')} onClick={() => setMode('group')}>جروب</button>
          </div>
        )}

        {mode === 'group' && (
          <>
            <div className="field">
              <label>اسم الجروب</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: فريق الرياض" />
            </div>
            <div className="field">
              <label>ربط بليد (اختياري)</label>
              {lead ? (
                <div className="chat-lead-chip static">
                  📎 {lead.full_name}{lead.file_no ? ` · ${lead.file_no}` : ''}
                  <button type="button" onClick={() => setLead(null)} aria-label="إزالة">✕</button>
                </div>
              ) : pickLead ? (
                <LeadPicker onPick={l => { setLead(l); setPickLead(false) }} onClose={() => setPickLead(false)} />
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setPickLead(true)}>اختيار ليد</button>
              )}
            </div>
          </>
        )}

        <input className="chat-search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="ابحث باسم الموظف أو الوظيفة" />

        <div className="chat-people">
          {shown.map(p => (
            mode === 'direct' ? (
              <button key={p.id} className="chat-person" disabled={busy} onClick={() => openDirect(p.id)}>
                <span className="chat-avatar">{p.full_name?.trim()?.[0]}</span>
                <span className="chat-person-name">{p.full_name}<small>{p.roles?.name_ar}</small></span>
              </button>
            ) : (
              <label key={p.id} className={'chat-person' + (picked.includes(p.id) ? ' on' : '')}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="chat-person-name">{p.full_name}<small>{p.roles?.name_ar}</small></span>
              </label>
            )
          ))}
          {!shown.length && <div className="chat-muted">لا يوجد موظفين</div>}
        </div>

        {err && <div className="chat-err">{err}</div>}

        <div className="modal-actions">
          {mode === 'group' && (
            <button className="btn btn-primary" disabled={busy} onClick={saveGroup}>
              إنشاء الجروب{picked.length ? ` (${picked.length})` : ''}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
