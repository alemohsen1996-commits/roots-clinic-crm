// مرفق الرسالة: صورة (بتتفتح كبيرة) أو ملف (تحميل) — الرابط موقّع ومؤقت
import { useEffect, useState } from 'react'
import { attachmentUrl } from './chatApi'
import useT from '../i18n/useT'

const fmtSize = (n) => !n ? '' : n > 1024 * 1024 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'

export default function Attachment({ m }) {
  const { t } = useT()
  const [url, setUrl] = useState(m._preview ?? null)
  const [open, setOpen] = useState(false)
  const isImage = m.attachment_type === 'image'

  useEffect(() => {
    if (!m.attachment_path) return
    let dead = false
    attachmentUrl(m.attachment_path).then(u => { if (!dead && u) setUrl(u) })
    return () => { dead = true }
  }, [m.attachment_path])

  if (isImage) {
    return (
      <>
        <button type="button" className={'chat-att-img' + (m._file ? ' pending' : '')} onClick={() => url && setOpen(true)} title={m.attachment_name ?? ''}>
          {url ? <img src={url} alt={m.attachment_name ?? t('chat.att.image')} loading="lazy" /> : <span className="chat-att-ph">🖼</span>}
        </button>
        {open && (
          <div className="chat-lightbox" onClick={() => setOpen(false)}>
            <img src={url} alt="" />
            <a className="btn btn-ghost btn-sm" href={url} download={m.attachment_name ?? 'image.jpg'} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}>⬇ {t('chat.att.download')}</a>
          </div>
        )}
      </>
    )
  }
  return (
    <a className="chat-att-file" href={url ?? '#'} target="_blank" rel="noreferrer" download={m.attachment_name ?? undefined}
      onClick={e => { if (!url) e.preventDefault() }}>
      <span className="chat-att-ico">📄</span>
      <span className="chat-att-meta">
        <b>{m.attachment_name ?? t('chat.att.file')}</b>
        <small>{fmtSize(m.attachment_size)}{url ? ` · ${t('chat.att.download')}` : ''}</small>
      </span>
    </a>
  )
}
