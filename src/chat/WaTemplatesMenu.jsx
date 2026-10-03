// قوالب واتساب للسيلز: زرار جنب الرقم بيفتح قايمة الرسايل الجاهزة ويبعتها على واتساب العميل
import { useEffect, useRef, useState } from 'react'
import { fetchWaTemplates, fillTemplate } from './chatApi'
import { openWhatsApp } from '../lib/format'
import useT from '../i18n/useT'

let cache = null
export default function WaTemplatesMenu({ lead }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(cache ?? [])
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    if (!cache) fetchWaTemplates().then(r => { cache = r.filter(x => x.is_active); setList(cache) }).catch(() => {})
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!lead?.phone) return null
  return (
    <span className="wa-tpl" ref={ref}>
      <button type="button" className="icon-btn" title={t('waTpl.pick')} onClick={() => setOpen(v => !v)}>📋</button>
      {open && (
        <div className="wa-tpl-menu">
          <div className="wa-tpl-head">{t('waTpl.pick')}</div>
          {!list.length && <div className="wa-tpl-empty">{t('waTpl.none')}</div>}
          {list.map(x => (
            <button key={x.id} type="button" onClick={() => { openWhatsApp(lead.phone, fillTemplate(x.body, lead)); setOpen(false) }}>
              <b>{x.title}</b>
              <small>{fillTemplate(x.body, lead)}</small>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
export const invalidateWaTemplates = () => { cache = null }
