// هل الشاشة موبايل؟ (نفس نقطة الكسر بتاعة الـ CSS: 900px) — بيتحدث مع تدوير الشاشة أو تصغير النافذة
import { useEffect, useState } from 'react'

export const MOBILE_BP = 900

export function useIsMobile(bp = MOBILE_BP) {
  const query = `(max-width: ${bp}px)`
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setIs(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return is
}
