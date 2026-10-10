// احتفال بسيط (قصاصات ورق ملوّنة + رسالة) — بيظهر لصاحب المركز الأول لما يفتح لوحة التحكم
// CSS بس (transform/opacity) من غير مكتبات، وبيختفي لوحده بعد ثانيتين ونص
// اللي مفعّل «تقليل الحركة» على جهازه بيشوف الرسالة بس من غير قصاصات
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const COLORS = ['#e3c576', '#c9a24b', '#f2d98d', '#b8bec8', '#e9edf2', '#7fb3a3', '#e8a0b4']
const PIECES = 70
const DURATION = 2600

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function Celebration({ message, onDone }) {
  const [gone, setGone] = useState(false)
  const quiet = useMemo(reducedMotion, [])
  const done = useRef(onDone)
  done.current = onDone

  // كل قصاصة: مكان أفقي، تأخير، مدة، دوران، لون، شكل
  const pieces = useMemo(() => (quiet ? [] : Array.from({ length: PIECES }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 450,
    dur: 1500 + Math.random() * 1000,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
    color: COLORS[i % COLORS.length],
    w: 6 + Math.random() * 5,
    round: Math.random() > 0.7,
  }))), [quiet])

  useEffect(() => {
    const t = setTimeout(() => { setGone(true); done.current?.() }, DURATION + 500)
    return () => clearTimeout(t)
  }, [])

  if (gone) return null
  return createPortal(
    <div className="celebrate" aria-live="polite">
      {pieces.map(p => (
        <i key={p.id} className="celebrate-bit"
          style={{
            left: p.left + '%',
            width: p.w, height: p.round ? p.w : p.w * 1.6,
            borderRadius: p.round ? '50%' : 2,
            background: p.color,
            animationDelay: p.delay + 'ms',
            animationDuration: p.dur + 'ms',
            '--drift': p.drift + 'px',
            '--spin': p.spin + 'deg',
          }} />
      ))}
      {message && <div className="celebrate-msg">{message}</div>}
    </div>,
    document.body
  )
}
