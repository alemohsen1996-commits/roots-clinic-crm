// تفاصيل الجروب: الأعضاء + إضافة/إزالة + تغيير الاسم + الخروج
import { useEffect, useMemo, useState } from 'react'
import { addMembers, errText, fetchEmployees, removeMember, renameGroup } from './chatApi'
import useT from '../i18n/useT'

export default function GroupInfoModal({ conv, participants, meId, canAdmin, readOnly, onClose, onChanged, onLeft }) {
  const { t, dn } = useT()
  const [title, setTitle] = useState(conv.title ?? '')
  const [people, setPeople] = useState([])
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const active = participants.filter(p => !p.left_at)
  const activeIds = useMemo(() => new Set(active.map(p => p.user_id)), [active])

  useEffect(() => { if (adding) fetchEmployees().then(setPeople).catch(() => {}) }, [adding])

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); await onChanged() } catch (e) { setErr(errText(e)) }
    setBusy(false)
  }

  const leave = async () => {
    if (!confirm(t('chat.leaveQ'))) return
    setBusy(true)
    try { await removeMember(conv.id, meId); onLeft() } catch (e) { setErr(errText(e)); setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal chat-modal" onClick={e => e.stopPropagation()}>
        <h2>{t('chat.groupInfo')}</h2>
        <div className="sub">{t('chat.nMembers', { n: active.length })}</div>

        {canAdmin && !readOnly ? (
          <div className="field">
            <label>{t('chat.groupName')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ flex: 1 }} value={title} onChange={e => setTitle(e.target.value)} />
              <button className="btn btn-ghost" disabled={busy || !title.trim() || title === conv.title}
                onClick={() => run(() => renameGroup(conv.id, title.trim()))}>{t('common.save')}</button>
            </div>
          </div>
        ) : <h3 style={{ marginBottom: 12 }}>{conv.title}</h3>}

        <div className="chat-people">
          {active.map(p => (
            <div key={p.user_id} className="chat-person">
              <span className="chat-avatar">{p.profiles?.full_name?.trim()?.[0]}</span>
              <span className="chat-person-name">
                {p.profiles?.full_name}{p.user_id === meId && ` (${t('chat.me')})`}
                <small>{dn(p.profiles?.roles)}{p.is_admin && ` · ${t('chat.groupAdmin')}`}</small>
              </span>
              {canAdmin && !readOnly && p.user_id !== meId && (
                <button className="chat-icon-btn" disabled={busy} title={t('chat.remove')}
                  onClick={() => confirm(t('chat.removeQ', { name: p.profiles?.full_name })) &&
                    run(() => removeMember(conv.id, p.user_id))}>✕</button>
              )}
            </div>
          ))}
        </div>

        {canAdmin && !readOnly && (adding ? (
          <>
            <div className="chat-people" style={{ marginTop: 10 }}>
              {people.filter(p => !activeIds.has(p.id)).map(p => (
                <label key={p.id} className={'chat-person' + (picked.includes(p.id) ? ' on' : '')}>
                  <input type="checkbox" checked={picked.includes(p.id)}
                    onChange={() => setPicked(x => x.includes(p.id) ? x.filter(i => i !== p.id) : [...x, p.id])} />
                  <span className="chat-person-name">{p.full_name}<small>{dn(p.roles)}</small></span>
                </label>
              ))}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !picked.length}
              onClick={() => run(async () => { await addMembers(conv.id, picked); setPicked([]); setAdding(false) })}>
              {t('common.add')} ({picked.length})
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ {t('chat.addMembers')}</button>
        ))}

        {err && <div className="chat-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          {!readOnly && <button className="btn btn-danger" disabled={busy} onClick={leave}>{t('chat.leaveGroup')}</button>}
        </div>
      </div>
    </div>
  )
}
