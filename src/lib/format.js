// دوال تنسيق مشتركة — تُستورد في أي شاشة

// الأرقام بالصيغة الغربية (0-9): أوضح وأسرع في القراءة داخل الجداول
// المالية، وأسهل في المقارنة البصرية بين المبالغ.
// التواريخ تبقى بالعربية لأن أسماء الشهور جزء من اللغة.
const NUM_LOCALE = 'en-US'

// التواريخ: أسماء شهور عربية بأرقام غربية (10 سبتمبر 2026)
// لاتساقها مع بقية أرقام النظام دون فقدان عروبة الواجهة
// — وبالإنجليزي: en-GB (10 Sep 2026)
import i18n from '../i18n'
const isEn = () => i18n.language === 'en'
const dateLocale = () => (isEn() ? 'en-GB' : 'ar-EG-u-nu-latn')

export const fmtNum = (n) => Number(n ?? 0).toLocaleString(NUM_LOCALE)

// اختصار للاستخدام المباشر في الشاشات
export const n = fmtNum

// رمز العملة حسب اللغة (ر.س / SAR)
export const cur = () => i18n.t('common.currency')

export const fmtMoney = (v, currency) =>
  `${fmtNum(v)} ${currency ?? cur()}`

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// وقت الحجز بنظام 12 ساعة: '14:00:00' → '2:00 م' — '09:30' → '9:30 ص' — '12:00' → '12:00 م'
export function fmtClock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  if (!m) return ''
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${i18n.t(h < 12 ? 'common.am' : 'common.pm')}`
}

// شهر وسنة — للوحة التحكم وأرشيف الشهور
export const fmtMonth = (d) =>
  d ? new Date(d).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }) : '—'

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
// نحتفظ بمرجع تبويب الويب (لمسار الاحتياط فقط)
let waWin = null

// text اختياري: رسالة جاهزة تتكتب في خانة الكتابة
export function openWhatsApp(phone, text) {
  const n = waNumber(phone)
  if (!n) return
  const t = text ? `&text=${encodeURIComponent(text)}` : ''

  // الموبايل: wa.me يفتح تطبيق واتساب مباشرة
  if (isMobile()) {
    window.open(`https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener')
    return
  }

  // سطح المكتب: نفتح تطبيق WhatsApp Desktop عبر بروتوكول whatsapp://
  // التطبيق يركّز محادثة العميل نفسها بلا فتح أي تبويب متصفّح.
  // ملاحظة: web.whatsapp.com يفرض عزلًا (COOP) يقطع صلة المتصفح بالتبويب
  // بعد أول فتحة، فيتعذّر إعادة استخدام تبويب الويب — لذا التطبيق هو الحل الأنظف.
  // إن لم يكن التطبيق مثبّتًا نرجع للنسخة الويب في تبويب واحد مُعاد استخدامه.
  const webUrl = `https://web.whatsapp.com/send?phone=${n}${t}`
  let appTook = false
  const onBlur = () => { appTook = true }   // فتح التطبيق يُفقد الصفحة التركيز
  window.addEventListener('blur', onBlur, { once: true })

  window.location.href = `whatsapp://send?phone=${n}${t}`

  setTimeout(() => {
    window.removeEventListener('blur', onBlur)
    if (appTook) return                       // التطبيق فتح المحادثة — بلا تبويب
    if (waWin && !waWin.closed) {
      try { waWin.location.href = webUrl } catch { waWin = window.open(webUrl, 'roots-whatsapp') }
    } else {
      waWin = window.open(webUrl, 'roots-whatsapp')
    }
    waWin?.focus()
  }, 700)
}

// "منذ ٥ دقائق" — لعمود آخر نشاط
export function timeAgo(d) {
  if (!d) return '—'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return i18n.t('time.now')
  const m = Math.floor(s / 60)
  if (m < 60) return i18n.t('time.minutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return i18n.t('time.hoursAgo', { n: h })
  const days = Math.floor(h / 24)
  if (days < 30) return i18n.t('time.daysAgo', { n: days })
  return fmtDate(d)
}
