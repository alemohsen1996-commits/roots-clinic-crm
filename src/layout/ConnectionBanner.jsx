// شريط حالة الاتصال — يظهر عند انقطاع الإنترنت ويختفي عند عودته
// يغطي كل الصفحات لأنه مركّب في نقطة الدخول (main.jsx)
import { useEffect, useRef, useState } from 'react'

export default function ConnectionBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  const [justBack, setJustBack] = useState(false)   // ومضة "عاد الاتصال"
  const wasOffline = useRef(false)

  useEffect(() => {
    function goOffline() {
      wasOffline.current = true
      setOnline(false)
      setJustBack(false)
    }

    function goOnline() {
      setOnline(true)
      // نُظهر ومضة العودة فقط إن كان هناك انقطاع فعلي
      if (wasOffline.current) {
        wasOffline.current = false
        setJustBack(true)
        // تحديث بيانات الصفحة الحالية بعد لحظة من عودة الشبكة
        setTimeout(() => {
          setJustBack(false)
          window.location.reload()
        }, 1200)
      }
    }

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    // فحص احتياطي كل 8 ثوانٍ: أحداث المتصفح لا تُطلق دائمًا عند
    // انقطاع لحظي أو فقد الاتصال بالخادم دون فقد الشبكة كليًا
    const probe = setInterval(async () => {
      if (!navigator.onLine) { goOffline(); return }
      // لو المتصفح يقول متصل لكننا كنا في وضع انقطاع، أكّد بطلب خفيف
      if (wasOffline.current) {
        try {
          await fetch('/favicon-32.png', { method: 'HEAD', cache: 'no-store' })
          goOnline()
        } catch { /* لسه مقطوع */ }
      }
    }, 8000)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      clearInterval(probe)
    }
  }, [])

  if (online && !justBack) return null

  return (
    <div className={'conn-banner ' + (justBack ? 'back' : 'off')} role="status">
      {justBack ? (
        <>✓ عاد الاتصال — يتم التحديث…</>
      ) : (
        <>
          <span className="conn-dot" />
          انقطع الاتصال بالإنترنت — سيُعاد الاتصال تلقائيًا عند عودة الشبكة
        </>
      )}
    </div>
  )
}
