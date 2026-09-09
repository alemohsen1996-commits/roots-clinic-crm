// تغيير إيميل أو باسورد حساب موظف موجود
// تغيير الإيميل: الموظف الجديد يرث نفس الحساب بكل ليداته
import { useState } from 'react'
import { changeEmployeeEmail, changeEmployeePassword, generatePassword } from './employeeApi'

export default function AccountActions({ person, mode, onClose, onSaved }) {
  // mode: 'email' | 'password'
  const [value, setValue] = useState(mode === 'password' ? generatePassword() : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function save() {
    setErr('')
    if (mode === 'email') {
      if (!value.trim() || !value.includes('@')) { setErr('اكتب بريدًا صحيحًا'); return }
    } else {
      if (value.length < 8) { setErr('كلمة المرور 8 أحرف على الأقل'); return }
    }
    setBusy(true)
    const res = mode === 'email'
      ? await changeEmployeeEmail({ user_id: person.id, new_email: value.trim() })
      : await changeEmployeePassword({ user_id: person.id, new_password: value })
    setBusy(false)
    if (res.error) {
      setErr(res.error.includes('already') ? 'هذا البريد مستخدم بالفعل' : res.error)
      return
    }
    setDone(true)
  }

  function copyText() {
    const text = mode === 'email'
      ? `بريدك الجديد للدخول: ${value}`
      : `كلمة المرور الجديدة: ${value}\nالرابط: https://roots-clinic-five.vercel.app`
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {done ? (
          <>
            <h2>تم التغيير</h2>
            <div className="cred-box" style={{ marginTop: 14 }}>
              <div>
                <span>{mode === 'email' ? 'البريد الجديد' : 'كلمة المرور الجديدة'}</span>
                <b dir="ltr">{value}</b>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>
              {mode === 'email'
                ? 'الموظف الآن يدخل بهذا البريد — الحساب وكل ليداته كما هي.'
                : 'أرسل كلمة المرور الجديدة للموظف.'}
            </p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={copyText}>
              نسخ
            </button>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onSaved}>تم</button>
            </div>
          </>
        ) : (
          <>
            <h2>{mode === 'email' ? 'تغيير البريد' : 'تغيير كلمة المرور'}: {person.full_name}</h2>
            <p className="sub">
              {mode === 'email'
                ? 'موظف جديد سيرث هذا الحساب بكل ليداته — فقط يتغير البريد'
                : 'إعادة تعيين كلمة مرور الموظف'}
            </p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label>{mode === 'email' ? 'البريد الجديد' : 'كلمة المرور الجديدة'}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input dir="ltr" style={{ flex: 1 }} value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={mode === 'email' ? 'new@gmail.com' : ''} />
                {mode === 'password' && (
                  <button type="button" className="btn btn-ghost"
                    onClick={() => setValue(generatePassword())}>توليد</button>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'تأكيد التغيير'}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
