// إضافة موظف جديد — المدير يحدد الإيميل والباسورد والوظيفة
// الحساب يُنشأ جاهزًا ومفعّلًا فورًا (عبر Edge Function الآمنة)
// بعد الإنشاء: يعرض البيانات لتنسخها وترسلها للموظف
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createEmployee, generatePassword } from './employeeApi'

export default function AddEmployeeModal({ onClose, onSaved }) {
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
    supabase.from('roles').select('id, code, name_ar').neq('code', 'super_admin')
      .then(({ data }) => setRoles(data ?? []))
    supabase.from('teams').select('id, name').eq('is_active', true)
      .then(({ data }) => setTeams(data ?? []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.full_name.trim()) { setErr('اكتب اسم الموظف'); return }
    if (!form.email.trim()) { setErr('اكتب البريد الإلكتروني'); return }
    if (form.password.length < 8) { setErr('كلمة المرور 8 أحرف على الأقل'); return }
    if (!form.role_id) { setErr('اختر الوظيفة'); return }
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
        ? 'هذا البريد مسجّل بالفعل'
        : error)
      return
    }
    setDone(true)
  }

  function copyCredentials() {
    const text = `بيانات الدخول — Roots Clinic\nالبريد: ${form.email}\nكلمة المرور: ${form.password}\nالرابط: https://roots-clinic-five.vercel.app`
    navigator.clipboard.writeText(text)
  }

  const roleName = roles.find(r => r.id === Number(form.role_id))?.name_ar

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {done ? (
          <>
            <h2>تم إنشاء حساب {form.full_name}</h2>
            <p className="sub">انسخ البيانات وأرسلها للموظف — لن تظهر كلمة المرور مرة أخرى</p>

            <div className="cred-box">
              <div><span>البريد</span><b dir="ltr">{form.email}</b></div>
              <div><span>كلمة المرور</span><b dir="ltr">{form.password}</b></div>
              <div><span>الوظيفة</span><b>{roleName}</b></div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={copyCredentials}>
              نسخ البيانات
            </button>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onSaved}>تم</button>
            </div>
          </>
        ) : (
          <>
            <h2>إضافة موظف جديد</h2>
            <p className="sub">تُنشئ الحساب جاهزًا بوظيفته — وترسل بياناته للموظف</p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label>الاسم الكامل</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="مثال: أحمد محمد" />
            </div>

            <div className="field">
              <label>البريد الإلكتروني</label>
              <input type="email" dir="ltr" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="name@gmail.com" />
            </div>

            <div className="field">
              <label>كلمة المرور</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input dir="ltr" style={{ flex: 1 }} value={form.password}
                  onChange={e => set('password', e.target.value)} />
                <button type="button" className="btn btn-ghost"
                  onClick={() => set('password', generatePassword())}>توليد</button>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>الوظيفة</label>
                <select value={form.role_id} onChange={e => set('role_id', e.target.value)}>
                  <option value="">— اختر —</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
                </select>
              </div>
              <div className="field">
                <label>الفريق (اختياري)</label>
                <select value={form.team_id} onChange={e => set('team_id', e.target.value)}>
                  <option value="">بدون فريق</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
