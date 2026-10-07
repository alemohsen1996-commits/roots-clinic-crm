// أصوات التنبيه داخل السيستم (وهو مفتوح) — متولّدة بـ Web Audio من غير ملفات صوت
// • message: نغمتين طالعين «تـِن-تـِن» — مميزة للشات
// • reaction: «بوب» قصير وخفيف
// • notify: نغمة الجرس (إشعارات السيستم)
// الآيفون مش بيسمح بالصوت غير بعد أول لمسة من المستخدم → بنفتح الصوت مع أول لمسة/زرار
// ملحوظة: إشعارات الموبايل والأبلكيشن مقفول بتستخدم صوت الجهاز الافتراضي (المتصفح مش بيسمح بصوت مخصص)

const KEY = 'chat-sound'   // '0' = مقفول
let ctx = null
const last = {}

export const soundEnabled = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
export const setSoundEnabled = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0') } catch {} }

function getCtx() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext
    if (!C) return null
    ctx = new C()
  }
  return ctx
}

// أول تفاعل من المستخدم: نشغّل الـ AudioContext بصوت فاضي عشان الآيفون يسمح بعد كده
function unlock() {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  try {
    const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource()
    s.buffer = b; s.connect(c.destination); s.start(0)
  } catch {}
}
if (typeof window !== 'undefined') {
  const once = () => { unlock(); ['pointerdown', 'keydown', 'touchend'].forEach(e => window.removeEventListener(e, once, true)) }
  ;['pointerdown', 'keydown', 'touchend'].forEach(e => window.addEventListener(e, once, true))
  // الآيفون بيوقف الصوت لما الأبلكيشن يروح الخلفية — نرجّعه أول ما يرجع
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended') ctx.resume().catch(() => {})
  })
}

function tone(c, t, { f, f2, dur, vol, type = 'sine' }) {
  const o = c.createOscillator(), g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.6)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t); o.stop(t + dur + 0.02)
}

const SOUNDS = {
  message: (c, t) => {
    tone(c, t,        { f: 988,  dur: 0.16, vol: 0.18 })            // B5
    tone(c, t + 0.11, { f: 1480, dur: 0.30, vol: 0.16 })            // F#6
    tone(c, t + 0.11, { f: 2960, dur: 0.18, vol: 0.03 })            // لمعة خفيفة
  },
  reaction: (c, t) => {
    tone(c, t, { f: 520, f2: 1250, dur: 0.14, vol: 0.2, type: 'triangle' })
  },
  notify: (c, t) => {
    tone(c, t,        { f: 880,  dur: 0.18, vol: 0.15 })
    tone(c, t + 0.12, { f: 1320, dur: 0.20, vol: 0.15 })
  },
}

// throttle: نفس الصوت مايتكررش أقل من ثانية (مثلًا لو وصل من القناة اللحظية والإشعار مع بعض)
export function playSound(kind = 'message') {
  if (!soundEnabled() || document.visibilityState !== 'visible') return
  const now = Date.now()
  if (now - (last[kind] ?? 0) < 1000) return
  last[kind] = now
  try {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    SOUNDS[kind]?.(c, c.currentTime + 0.01)
  } catch {}
}
