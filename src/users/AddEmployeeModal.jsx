// إضافة موظف جديد — المدير يحدد الإيميل والباسورد والوظيفة
// الحساب يُنشأ جاهزًا ومفعّلًا فورًا (عبر Edge Function الآمنة)
// بعد الإنشاء: يعرض البيانات لتنسخها وترسلها للموظف
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createEmployee, generatePassword } from './employeeApi'
import useT from '../i18n/useT'

export default function AddEmployeeModal({ onClose, onSaved }) {
  const { t, dn } = useT()
  const [roles, setRoles] = useState([])
  const [teams, setTeams] = useState([])
  const [form, setForm] = useState({
    full_name: '', email: '', password: generatePassword(),
    role_id: '', team_id: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)   // بعد النجاح: عرض البيانات للنسخ

  useEffect(() => {
    supabase.from('roles').select('id, code, name_ar, name_en').neq('code', 'super_admin')
      .then(({ data }) => setRoles(data ?? []))
    supabase.from('teams').select('id, name').eq('is_active', true)
      .then(({ data }) => setTeams(data ?? []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.full_name.trim()) { setErr(t('team.nameRequired')); return }
    if (!form.email.trim()) { setErr(t('team.emailRequired')); return }
    if (form.password.length < 8) { setErr(t('team.passwordMin')); return }
    if (!form.role_id) { setErr(t('team.roleRequired')); return }
    setErr(''); setBusy(true)

    const { error } = await createEmployee({
      email: form.email.trim(),
      password: form.password,
      full_name: form.full_name.trim(),
      role_id: Number(form.role_id),
      team_id: form.team_id ? Number(form.team_id) : null,
    })

    setBusy(false)
    if (error) {
      setErr(error.includes('already') || error.includes('registered')
        ? t('team.emailTaken')
        : error)
      return
    }
    setDone(true)
  }

  function copyCredentials() {
    const text = `${t('team.credentials')} — Roots Clinic\n${t('auth.email')}: ${form.email}\n${t('auth.password')}: ${form.password}\n${t('team.link')}: https://roots-clinic-five.vercel.app`
    navigator.clipboard.writeText(text)
  }

  const roleName = dn(roles.find(r => r.id === Number(form.role_id)))

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {done ? (
          <>
            <h2>{t('team.accountCreated', { name: form.full_name })}</h2>
            <p className="sub">{t('team.copyCredentialsNote')}</p>

            <div className="cred-box">
              <div><span>{t('auth.email')}</span><b dir="ltr">{form.email}</b></div>
              <div><span>{t('auth.password')}</span><b dir="ltr">{form.password}</b></div>
              <div><span>{t('common.role')}</span><b>{roleName}</b></div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={copyCredentials}>
              {t('team.copyCredentials')}
            </button>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onSaved}>{t('common.ok')}</button>
            </div>
          </>
        ) : (
          <>
            <h2>{t('team.addEmployee')}</h2>
            <p className="sub">{t('team.addEmployeeSub')}</p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label>{t('lead.fullName')}</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder={t('team.namePh')} />
            </div>

            <div className="field">
              <label>{t('auth.email')}</label>
              <input type="email" dir="ltr" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="name@gmail.com" />
            </div>

            <div className="field">
              <label>{t('auth.password')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input dir="ltr" style={{ flex: 1 }} value={form.password}
                  onChange={e => set('password', e.target.value)} />
                <button type="button" className="btn btn-ghost"
                  onClick={() => set('password', generatePassword())}>{t('team.generate')}</button>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{t('common.role')}</label>
                <select value={form.role_id} onChange={e => set('role_id', e.target.value)}>
                  <option value="">{t('common.pick')}</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{dn(r)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>{t('team.teamOptional')}</label>
                <select value={form.team_id} onChange={e => set('team_id', e.target.value)}>
                  <option value="">{t('team.noTeam')}</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? t('team.creating') : t('team.createAccount')}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
