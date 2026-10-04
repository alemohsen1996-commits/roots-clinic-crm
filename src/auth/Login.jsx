// شاشة تسجيل الدخول
// - لو الموظف داخل أصلًا → يروح للسيستم على طول
// - بعد الدخول يرجع للصفحة اللي كان رايحها (لو اتحوّل للدخول من رابط)
// - إظهار كلمة المرور + تنبيه Caps Lock + رسائل خطأ واضحة حسب السبب
// - نسيت كلمة المرور: الحسابات بيديرها المدير من صفحة الفريق، فالحل عنده
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import AuthSide, { RootsEmblem } from './AuthSide'
import useT from '../i18n/useT'
import LangToggle from '../layout/LangToggle'

// المسار اللي يرجع له بعد الدخول — داخلي بس، عشان محدش يستغل الرابط للتحويل لموقع بره
function safeFrom(from) {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/login'
    ? from : '/'
}

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 20 20 4" />}
  </svg>
)

export default function Login() {
  const nav = useNavigate()
  const location = useLocation()
  const { session, loading } = useAuth()
  const { t } = useT()
  const from = safeFrom(location.state?.from)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [caps, setCaps] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const passRef = useRef(null)

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  // داخل أصلًا
  if (!loading && session) return <Navigate to={from} replace />

  function errorText(error) {
    const msg = String(error?.message ?? '').toLowerCase()
    if (!navigator.onLine || error?.name === 'AuthRetryableFetchError' || msg.includes('fetch'))
      return t('auth.err.network')
    if (error?.status === 429 || msg.includes('rate limit') || msg.includes('too many'))
      return t('auth.err.tooMany')
    if (msg.includes('email not confirmed')) return t('auth.err.notConfirmed')
    if (msg.includes('invalid login credentials')) return t('auth.badCredentials')
    return t('auth.loginFailed')
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    setBusy(false)
    if (error) {
      setErr(errorText(error))
      // غالبًا الغلط في كلمة المرور — نرجّع التركيز عليها ونحددها عشان تتكتب من جديد
      requestAnimationFrame(() => { passRef.current?.focus(); passRef.current?.select() })
      return
    }
    nav(from, { replace: true })
  }

  const onPassKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'))

  return (
    <div className="auth-screen">
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-brand">
            <RootsEmblem className="auth-mini-emblem" />
            <span>Roots Clinic</span>
            <LangToggle compact />
          </div>

          <h1>{t('auth.welcome')}</h1>
          <p className="sub">{t('auth.sub')}</p>

          {!online && <div className="alert alert-error" role="alert">{t('auth.err.offline')}</div>}
          {err && <div className="alert alert-error" role="alert" aria-live="assertive">{err}</div>}

          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" type="email" dir="ltr" required autoFocus
              autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
              value={email} onChange={e => { setEmail(e.target.value); if (err) setErr('') }}
              placeholder="name@gmail.com" />
          </div>

          <div className="field">
            <label htmlFor="pass">{t('auth.password')}</label>
            <div className="pass-wrap">
              <input id="pass" ref={passRef} type={showPass ? 'text' : 'password'} dir="ltr" required
                autoComplete="current-password" autoCapitalize="none" spellCheck={false}
                value={password} onChange={e => { setPassword(e.target.value); if (err) setErr('') }}
                onKeyDown={onPassKey} onKeyUp={onPassKey} onBlur={() => setCaps(false)}
                placeholder="••••••••" aria-describedby={caps ? 'caps-warn' : undefined} />
              <button type="button" className="pass-eye" onClick={() => setShowPass(v => !v)}
                aria-label={showPass ? t('auth.hidePassword') : t('auth.showPassword')}
                title={showPass ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={showPass}>
                <EyeIcon off={showPass} />
              </button>
            </div>
            {caps && <small id="caps-warn" className="caps-warn">{t('auth.capsLock')}</small>}
          </div>

          <button className="btn btn-primary auth-submit" disabled={busy || !email.trim() || !password}>
            {busy && <span className="btn-spin" aria-hidden="true" />}
            {busy ? t('auth.loggingIn') : t('auth.login')}
          </button>

          <div className="auth-help">
            <button type="button" className="auth-link" aria-expanded={showForgot}
              onClick={() => setShowForgot(v => !v)}>
              {t('auth.forgot')}
            </button>
            {showForgot && <p className="auth-help-note">{t('auth.forgotBody')}</p>}
          </div>
        </form>
      </div>
      <AuthSide />
    </div>
  )
}
