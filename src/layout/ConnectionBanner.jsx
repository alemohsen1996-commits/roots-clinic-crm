// شريط حالة الاتصال — يظهر عند انقطاع الإنترنت فقط
// لا يُعيد تحميل الصفحة إطلاقًا: مجرد إشعار بصري.
// (إعادة التحميل التلقائي كانت تُطلق بالخطأ مع الشبكة البطيئة
//  فتُفقد اللوحة المفتوحة وتحدث "ريفرش" غير مبرّر)
import { useEffect, useState } from 'react'
import useT from '../i18n/useT'

export default function ConnectionBanner() {
  const { t } = useT()
  const [online, setOnline] = useState(navigator.onLine)
  const [justBack, setJustBack] = useState(false)

  useEffect(() => {
    let backTimer = null

    function goOffline() {
      setOnline(false)
      setJustBack(false)
    }

    function goOnline() {
      setOnline(true)
      // ومضة "عاد الاتصال" ثم تختفي — بلا إعادة تحميل
      setJustBack(true)
      if (backTimer) clearTimeout(backTimer)
      backTimer = setTimeout(() => setJustBack(false), 2500)
    }

    // نعتمد فقط على أحداث المتصفح الصريحة — لا فحص دوري
    // (الفحص الدوري كان يخلط بطء الشبكة بالانقطاع فيُعيد التحميل خطأً)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      if (backTimer) clearTimeout(backTimer)
    }
  }, [])

  if (online && !justBack) return null

  return (
    <div className={'conn-banner ' + (justBack ? 'back' : 'off')} role="status">
      {justBack ? (
        <>{t('conn.back')}</>
      ) : (
        <>
          <span className="conn-dot" />
          {t('conn.offline')}
        </>
      )}
    </div>
  )
}
