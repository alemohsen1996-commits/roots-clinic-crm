// دوال تنسيق مشتركة — تُستورد في أي شاشة

// الأرقام بالصيغة الغربية (0-9): أوضح وأسرع في القراءة داخل الجداول
// المالية، وأسهل في المقارنة البصرية بين المبالغ.
// التواريخ تبقى بالعربية لأن أسماء الشهور جزء من اللغة.
const NUM_LOCALE = 'en-US'

// التواريخ: أسماء شهور عربية بأرقام غربية (10 سبتمبر 2026)
// لاتساقها مع بقية أرقام النظام دون فقدان عروبة الواجهة
const DATE_LOCALE = 'ar-EG-u-nu-latn'

export const fmtNum = (n) => Number(n ?? 0).toLocaleString(NUM_LOCALE)

// اختصار للاستخدام المباشر في الشاشات
export const n = fmtNum

export const fmtMoney = (v, currency = 'ر.س') =>
  `${fmtNum(v)} ${currency}`

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// شهر وسنة — للوحة التحكم وأرشيف الشهور
export const fmtMonth = (d) =>
  d ? new Date(d).toLocaleDateString(DATE_LOCALE, { month: 'long', year: 'numeric' }) : '—'

// رقم صالح لرابط واتساب: أرقام فقط بلا + أو مسافات
export const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

// فتح محادثة واتساب في تبويب واحد ثابت بدل تبويب لكل عميل
// (الموظف يفتح عشرات العملاء يوميًا فتتراكم التبويبات)
export function openWhatsApp(phone) {
  const n = waNumber(phone)
  if (!n) return
  const w = window.open(`https://wa.me/${n}`, 'roots-whatsapp')
  // إن كان التبويب مفتوحًا بالفعل، اجلبه للواجهة
  if (w) w.focus()
}

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
