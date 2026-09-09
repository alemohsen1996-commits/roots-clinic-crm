// شاشة تسجيل الدخول
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthSide from './AuthSide'

export default function Login() {
  const nav = useNavigate()
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
        ? 'البريد أو كلمة المرور غير صحيحة'
        : 'تعذر تسجيل الدخول — حاول مرة أخرى')
      return
    }
    nav('/')
  }

  return (
    <div className="auth-screen">
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-brand">Roots Clinic</div>
          <h1>أهلاً بعودتك</h1>
          <p className="sub">سجّل دخولك لإدارة عيادتك</p>

          {err && <div className="alert alert-error">{err}</div>}

          <div className="field">
            <label htmlFor="email">البريد الإلكتروني</label>
            <input id="email" type="email" dir="ltr" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@gmail.com" />
          </div>

          <div className="field">
            <label htmlFor="pass">كلمة المرور</label>
            <input id="pass" type="password" dir="ltr" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" />
          </div>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>
      </div>
      <AuthSide />
    </div>
  )
}
