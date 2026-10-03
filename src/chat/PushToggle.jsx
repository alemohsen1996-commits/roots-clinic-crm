// تفعيل إشعارات الموبايل/الكمبيوتر للشات
import { useEffect, useState } from 'react'
import { disablePush, enablePush, getPushState } from '../lib/push'
import useT from '../i18n/useT'

const HIDE_KEY = 'push-banner-hidden-until'

export default function PushToggle() {
  const { t } = useT()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState(() => Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now())

  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')) }, [])

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { setState(await fn()) } catch (e) { console.error(e); setErr(t('chat.push.enableFailed')) }
    setBusy(false)
  }
  const hide = () => { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)); setHidden(true) }

  if (!state || state === 'unsupported') return null

  if (state === 'on') return (
    <button className="chat-push-on" disabled={busy} title={t('chat.push.disableTitle')}
      onClick={() => confirm(t('chat.push.disableQ')) && run(disablePush)}>
      🔔 {t('chat.push.enabled')}
    </button>
  )

  if (hidden) return (
    <button className="chat-push-on off" onClick={() => setHidden(false)}>🔕 {t('chat.push.off')}</button>
  )

  return (
    <div className="chat-push-banner">
      {state === 'off' && <>
        <span>🔔 {t('chat.push.prompt')}</span>
        <div className="chat-push-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(enablePush)}>{t('chat.push.enable')}</button>
          <button className="btn btn-ghost" onClick={hide}>{t('chat.push.later')}</button>
        </div>
      </>}
      {state === 'ios-install' && <>
        <span>📱 {t('chat.push.ios')}</span>
        <div className="chat-push-actions"><button className="btn btn-ghost" onClick={hide}>{t('common.ok')}</button></div>
      </>}
      {state === 'denied' && <>
        <span>🔕 {t('chat.push.denied')}</span>
        <div className="chat-push-actions"><button className="btn btn-ghost" onClick={hide}>{t('common.ok')}</button></div>
      </>}
      {err && <div className="chat-err">{err}</div>}
    </div>
  )
}
