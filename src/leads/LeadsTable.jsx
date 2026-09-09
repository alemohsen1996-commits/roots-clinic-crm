// عرض الجدول — نفس البيانات بشكل قائمة للفرز السريع
// + تحديد متعدد (للمدير) لتنفيذ إجراءات جماعية
import { timeAgo, fmtDate } from '../lib/format'

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
                onClick={() => onOpen(l)}
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
                <td dir="ltr" style={{ textAlign: 'right' }}>{l.phone}</td>
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
