// إصلاح آيفون: لما السيستم مفتوح كتطبيق من الشاشة الرئيسية مع شريط حالة شفاف (black-translucent)
// سفاري بيحسب ارتفاع الشاشة ناقص ارتفاع شريط الحالة — فأي عنصر ثابت تحت (bottom: 0)
// زي الشريط السفلي وأزرار ملف الليد بيطلع فوق حافة الشاشة بمسافة فاضية.
// الشريط اللي تحت ده مينفعش أي عنصر ثابت يترسم فيه (اتجرّب: العنصر بيتقص)،
// وهو نفسه مكان شَرطة الـ Home. فلما نلاقي الفرق بنحط class="ios-gap" على <html>،
// والـ CSS بيشيل الـ safe-area من تحت ويخلّي الشريط السفلي بلون الصفحة فيبان متصل بالشريط.
// على أي جهاز تاني (أو لو أبل صلّحت الباج) الفرق = 0 ومفيش أي تغيير.

const isIOS = () => {
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}
const isStandalone = () =>
  navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches

function measure() {
  const root = document.documentElement
  if (!document.body || !isIOS() || !isStandalone()) {
    root.style.removeProperty('--ios-gap'); root.classList.remove('ios-gap'); return
  }

  // ارتفاع المنطقة اللي العناصر الثابتة بتتحسب منها فعلًا
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;bottom:0;width:0;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const viewportH = probe.getBoundingClientRect().height
  probe.remove()

  const portrait = window.innerHeight >= window.innerWidth
  const screenH = portrait
    ? Math.max(window.screen.width, window.screen.height)
    : Math.min(window.screen.width, window.screen.height)
  const gap = Math.round(screenH - viewportH)

  // فرق منطقي بس (ارتفاع شريط حالة) — أي رقم أكبر يبقى حاجة تانية (تقسيم شاشة على الآيباد مثلًا)
  if (gap > 0 && gap < 100) {
    root.style.setProperty('--ios-gap', gap + 'px'); root.classList.add('ios-gap')
  } else {
    root.style.removeProperty('--ios-gap'); root.classList.remove('ios-gap')
  }
}

let timer = null
const soon = (ms = 150) => { clearTimeout(timer); timer = setTimeout(measure, ms) }

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => measure())
  else measure()
  window.addEventListener('resize', () => soon())
  window.addEventListener('orientationchange', () => soon(400))
  window.addEventListener('pageshow', () => soon())
}
