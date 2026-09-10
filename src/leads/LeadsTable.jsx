// عرض الجدول — نفس البيانات بشكل قائمة للفرز السريع
// + تحديد متعدد (للمدير) لتنفيذ إجراءات جماعية
import { timeAgo, fmtDate } from '../lib/format'

const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

function PhoneCell({ phone }) {
  if (!phone) return <span style={{ color: 'var(--ink-soft)' }}>—</span>
  return (
    <div className="phone-cell" onClick={e => e.stopPropagation()}>
      <span dir="ltr">{phone}</span>
      <a className="icon-btn" href={`tel:${phone}`} title="اتصال">☎</a>
      <a className="icon-btn" title="واتساب" target="_blank" rel="noreferrer"
        href={`https://wa.me/${waNumber(phone)}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
        </svg>
      </a>
      <button className="icon-btn" title="نسخ الرقم"
        onClick={() => navigator.clipboard?.writeText(phone)}>⧉</button>
    </div>
  )
}

export default function LeadsTable({ leads, onOpen, selectable, selected, onToggle, onToggleAll }) {
  if (!leads.length) {
    return (
      <div className="card empty">
        <strong>لا توجد ليدات مطابقة</strong>
        جرّب تعديل الفلاتر أو أضف ليدًا جديدًا
      </div>
    )
  }

  const allOnPage = selectable && leads.every(l => selected?.has(l.id))
  const someOnPage = selectable && !allOnPage && leads.some(l => selected?.has(l.id))

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={!!allOnPage}
                  ref={el => { if (el) el.indeterminate = !!someOnPage }}
                  onChange={e => onToggleAll(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                  title="تحديد كل ما في الصفحة"
                />
              </th>
            )}
            <th>رقم الملف</th><th>الاسم</th><th>الهاتف</th><th>المرحلة</th>
            <th>المصدر</th><th>المسؤول</th><th>آخر نشاط</th><th>أُنشئ</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => {
            const on = selectable && selected?.has(l.id)
            return (
              <tr key={l.id}
                onClick={() => onOpen(l, leads)}
                style={{ cursor: 'pointer', background: on ? 'var(--primary-soft, #1a3a5c10)' : undefined }}>
                {selectable && (
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={!!on}
                      onChange={() => onToggle(l.id)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  </td>
                )}
                <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{l.file_no}</td>
                <td style={{ fontWeight: 600 }}>{l.full_name}</td>
                <td><PhoneCell phone={l.phone} /></td>
                <td>
                  <span className="badge" style={{
                    background: (l.stages?.color ?? '#888') + '22',
                    color: l.stages?.color ?? '#888',
                  }}>
                    {l.stages?.name_ar}
                  </span>
                </td>
                <td>{l.lead_sources?.name_ar ?? '—'}</td>
                <td>{l.owner?.full_name ?? 'غير مسند'}</td>
                <td>{timeAgo(l.last_activity)}</td>
                <td>{fmtDate(l.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
