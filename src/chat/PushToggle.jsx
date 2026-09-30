// تفعيل إشعارات الموبايل/الكمبيوتر للشات
import { useEffect, useState } from 'react'
import { disablePush, enablePush, getPushState } from '../lib/push'

const HIDE_KEY = 'push-banner-hidden-until'

export default function PushToggle() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(() => Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now())

  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')) }, [])

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { setState(await fn()) } catch (e) { console.error(e); setErr('تعذّر التفعيل — حاول تاني') }
    setBusy(false)
  }
  const hide = () => { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)); setHidden(true) }

  if (!state || state === 'unsupported') return null

  if (state === 'on') return (
    <button className="chat-push-on" disabled={busy} title="إيقاف الإشعارات على الجهاز ده"
      onClick={() => confirm('توقف إشعارات الشات على الجهاز ده؟') && run(disablePush)}>
      🔔 الإشعارات مفعّلة
    </button>
  )

  if (hidden) return (
    <button className="chat-push-on off" onClick={() => setHidden(false)}>🔕 الإشعارات مقفولة</button>
  )

  return (
    <div className="chat-push-banner">
      {state === 'off' && <>
        <span>🔔 فعّل الإشعارات عشان توصلك الرسائل حتى لو الأبلكيشن مقفول</span>
        <div className="chat-push-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(enablePush)}>تفعيل</button>
          <button className="btn btn-ghost" onClick={hide}>لاحقًا</button>
        </div>
      </>}
      {state === 'ios-install' && <>
        <span>📱 على الآيفون: افتح الـ CRM من Safari ← زر المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية»، وبعدين افتحه من الأيقونة وفعّل الإشعارات من هنا</span>
        <div className="chat-push-actions"><button className="btn btn-ghost" onClick={hide}>تمام</button></div>
      </>}
      {state === 'denied' && <>
        <span>🔕 الإشعارات مرفوضة للموقع ده — فعّلها من إعدادات المتصفح (رمز القفل جنب الرابط ← الإشعارات ← سماح) وبعدين ارجع هنا</span>
        <div className="chat-push-actions"><button className="btn btn-ghost" onClick={hide}>تمام</button></div>
      </>}
      {err && <div className="chat-err">{err}</div>}
    </div>
  )
}
