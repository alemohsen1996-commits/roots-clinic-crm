// شاشة تسجيل الدخول
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthSide from './AuthSide'
import useT from '../i18n/useT'
import LangToggle from '../layout/LangToggle'

export default function Login() {
  const nav = useNavigate()
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setErr(error.message === 'Invalid login credentials'
        ? t('auth.badCredentials')
        : t('auth.loginFailed'))
      return
    }
    nav('/')
  }

  return (
    <div className="auth-screen">
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-brand">
            Roots Clinic
            <LangToggle compact />
          </div>
          <h1>{t('auth.welcome')}</h1>
          <p className="sub">{t('auth.sub')}</p>

          {err && <div className="alert alert-error">{err}</div>}

          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" type="email" dir="ltr" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@gmail.com" />
          </div>

          <div className="field">
            <label htmlFor="pass">{t('auth.password')}</label>
            <input id="pass" type="password" dir="ltr" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" />
          </div>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
            {busy ? t('auth.loggingIn') : t('auth.login')}
          </button>
        </form>
      </div>
      <AuthSide />
    </div>
  )
}
