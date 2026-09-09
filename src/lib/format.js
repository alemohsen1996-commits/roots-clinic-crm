// دوال تنسيق مشتركة — تُستورد في أي شاشة
export const fmtNum = (n) => Number(n ?? 0).toLocaleString('ar-EG')

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// "منذ ٥ دقائق" — لعمود آخر نشاط
export function timeAgo(d) {
  if (!d) return '—'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'الآن'
  const m = Math.floor(s / 60)
  if (m < 60) return `منذ ${m} د`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} س`
  const days = Math.floor(h / 24)
  if (days < 30) return `منذ ${days} يوم`
  return fmtDate(d)
}
