// نقاشات الليد: كل رسايل الشات المربوطة بالليد ده في المحادثات اللي الموظف شايفها
import { useEffect, useState } from 'react'
import { fetchLeadMessages } from './chatApi'
import { fmtDateTime } from '../lib/format'
import useT from '../i18n/useT'

export default function LeadDiscussions({ leadId, meId, onCount, onOpen }) {
  const { t } = useT()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let dead = false
    fetchLeadMessages(leadId).then(r => { if (!dead) { setRows(r); onCount?.(r.length) } })
      .catch(() => { if (!dead) setRows([]) })
    return () => { dead = true }
  }, [leadId, onCount])

  if (rows === null) return <div className="empty" style={{ padding: 20 }}>{t('common.loading')}</div>
  if (!rows.length) return <div className="empty" style={{ padding: 20 }}>{t('chat.noLeadDiscussions')}</div>

  return (
    <div className="timeline-scroll lead-discussions">
      {rows.map(r => (
        <button key={r.id} type="button" className="lead-discussion" onClick={() => onOpen(r.conversation_id)}>
          <div className="ld-top">
            <b>{r.sender_id === meId ? t('chat.you') : (r.sender_name ?? t('chat.employee'))}</b>
            {r.conv_kind === 'group' && <small>{t('chat.inChat')} {r.conv_title}</small>}
            <time>{fmtDateTime(r.created_at)}</time>
          </div>
          <div className="ld-body">
            {r.body || (r.attachment_type === 'image' ? `📷 ${t('chat.att.image')}` : r.attachment_type === 'file' ? `📄 ${r.attachment_name ?? ''}` : '📎')}
          </div>
        </button>
      ))}
    </div>
  )
}
