// اختيار ليد لإرفاقه برسالة أو جروب — بحث بالاسم أو الموبايل أو رقم الملف
import { useEffect, useRef, useState } from 'react'
import { searchLeads } from './chatApi'

export default function LeadPicker({ onPick, onClose, autoFocus = true }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const reqId = useRef(0)

  useEffect(() => {
    const id = ++reqId.current
    if (q.trim().length < 2) { setRows([]); return }
    setBusy(true)
    const t = setTimeout(async () => {
      const r = await searchLeads(q)
      if (id === reqId.current) { setRows(r); setBusy(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="chat-leadpick">
      <div className="chat-leadpick-head">
        <input autoFocus={autoFocus} value={q} onChange={e => setQ(e.target.value)}
          placeholder="ابحث باسم العميل أو الموبايل أو رقم الملف" />
        {onClose && <button type="button" className="chat-icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>}
      </div>
      <div className="chat-leadpick-list">
        {busy && <div className="chat-muted">جارٍ البحث…</div>}
        {!busy && q.trim().length >= 2 && !rows.length && <div className="chat-muted">لا نتائج</div>}
        {rows.map(l => (
          <button type="button" key={l.id} className="chat-leadpick-row" onClick={() => onPick(l)}>
            <strong>{l.full_name}</strong>
            <span>{[l.file_no, l.phone].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
