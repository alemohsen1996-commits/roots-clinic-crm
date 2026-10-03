// تغيير إيميل أو باسورد حساب موظف موجود
// تغيير الإيميل: الموظف الجديد يرث نفس الحساب بكل ليداته
import { useState } from 'react'
import { changeEmployeeEmail, changeEmployeePassword, generatePassword } from './employeeApi'
import useT from '../i18n/useT'

export default function AccountActions({ person, mode, onClose, onSaved }) {
  const { t } = useT()
  // mode: 'email' | 'password'
  const [value, setValue] = useState(mode === 'password' ? generatePassword() : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function save() {
    setErr('')
    if (mode === 'email') {
      if (!value.trim() || !value.includes('@')) { setErr(t('team.validEmail')); return }
    } else {
      if (value.length < 8) { setErr(t('team.passwordMin')); return }
    }
    setBusy(true)
    const res = mode === 'email'
      ? await changeEmployeeEmail({ user_id: person.id, new_email: value.trim() })
      : await changeEmployeePassword({ user_id: person.id, new_password: value })
    setBusy(false)
    if (res.error) {
      setErr(res.error.includes('already') ? t('team.emailTaken') : res.error)
      return
    }
    setDone(true)
  }

  function copyText() {
    const text = mode === 'email'
      ? `${t('team.yourNewEmail')}: ${value}`
      : `${t('team.newPassword')}: ${value}\n${t('team.link')}: https://roots-clinic-five.vercel.app`
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {done ? (
          <>
            <h2>{t('team.changed')}</h2>
            <div className="cred-box" style={{ marginTop: 14 }}>
              <div>
                <span>{mode === 'email' ? t('team.newEmail') : t('team.newPassword')}</span>
                <b dir="ltr">{value}</b>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>
              {mode === 'email'
                ? t('team.emailChangedNote')
                : t('team.sendPasswordNote')}
            </p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={copyText}>
              {t('team.copy')}
            </button>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onSaved}>{t('common.ok')}</button>
            </div>
          </>
        ) : (
          <>
            <h2>{mode === 'email' ? t('team.changeEmail') : t('team.changePassword')}: {person.full_name}</h2>
            <p className="sub">
              {mode === 'email'
                ? t('team.changeEmailSub')
                : t('team.changePasswordSub')}
            </p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label>{mode === 'email' ? t('team.newEmail') : t('team.newPassword')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input dir="ltr" style={{ flex: 1 }} value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={mode === 'email' ? 'new@gmail.com' : ''} />
                {mode === 'password' && (
                  <button type="button" className="btn btn-ghost"
                    onClick={() => setValue(generatePassword())}>{t('team.generate')}</button>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? t('common.saving') : t('team.confirmChange')}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
