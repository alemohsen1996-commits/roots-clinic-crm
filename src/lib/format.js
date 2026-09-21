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

const isMobile = () =>
  /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent)

// فتح محادثة واتساب في تبويب واحد ثابت بدل تبويب لكل عميل
//
// نتجنّب wa.me على سطح المكتب لأنه يمرّ بصفحة api.whatsapp.com
// الوسيطة، وذلك التحويل يفقد اسم التبويب فيُفتح تبويب جديد كل مرة
// (وتظهر معه نافذة "Open WhatsApp?" في كل ضغطة).
// web.whatsapp.com يفتح المحادثة مباشرة ويحترم اسم التبويب.
// نحتفظ بمرجع النافذة التي فتحناها — أمتن من الاعتماد على اسم النافذة
// (المواقع الخارجية تمسح window.name، فيضيع التبويب ويُفتح غيره)
let waWin = null

export function openWhatsApp(phone) {
  const n = waNumber(phone)
  if (!n) return

  // الموبايل: wa.me يفتح تطبيق واتساب مباشرة
  // سطح المكتب: web.whatsapp.com يفتح نسخة الويب
  const url = isMobile()
    ? `https://wa.me/${n}`
    : `https://web.whatsapp.com/send?phone=${n}`

  // نافذة سابقة ما زالت مفتوحة؟ انقلها للعميل الجديد وركّز عليها.
  // الكتابة في location مسموحة عبر الأصول (الممنوع هو القراءة فقط)،
  // فلا نفتح تبويبًا جديدًا في كل مرة.
  if (waWin && !waWin.closed) {
    try {
      waWin.location.href = url
      waWin.focus()
      return
    } catch {
      // تعذّر النقل لأي سبب — نفتح نافذة جديدة أدناه
    }
  }

  waWin = window.open(url, 'roots-whatsapp')
  waWin?.focus()
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
