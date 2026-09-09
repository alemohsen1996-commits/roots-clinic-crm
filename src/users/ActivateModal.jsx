// نافذة تفعيل الموظف / تعديل صلاحياته
// تحدد: الدور، الفريق، إعدادات التوزيع (الوزن والحد اليومي)، الهدف الشهري
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

export default function ActivateModal({ person, onClose, onSaved }) {
  const { profile: me } = useAuth()
  const [roles, setRoles] = useState([])
  const [teams, setTeams] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    role_id: person.role_id ?? '',
    team_id: person.team_id ?? '',
    in_rotation: person.in_rotation ?? false,
    weight: person.weight ?? 1,
    daily_cap: person.daily_cap ?? 30,
    monthly_target: person.monthly_target ?? 0,
  })

  useEffect(() => {
    supabase.from('roles').select('id, code, name_ar')
      .neq('code', 'super_admin')   // لا يُمنح دور المدير العام من هنا
      .then(({ data }) => setRoles(data ?? []))
    supabase.from('teams').select('id, name').eq('is_active', true)
      .then(({ data }) => setTeams(data ?? []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isAgent = roles.find(r => r.id === Number(form.role_id))?.code === 'agent'

  async function save() {
    if (!form.role_id) { setErr('اختر الدور أولًا'); return }
    setErr(''); setBusy(true)

    const wasPending = person.status === 'pending'
    const { error } = await supabase.from('profiles').update({
      role_id: Number(form.role_id),
      team_id: form.team_id ? Number(form.team_id) : null,
      in_rotation: isAgent ? form.in_rotation : false,
      weight: Number(form.weight),
      daily_cap: Number(form.daily_cap),
      monthly_target: Number(form.monthly_target),
      status: 'active',
      ...(wasPending && { activated_by: me.id, activated_at: new Date().toISOString() }),
    }).eq('id', person.id)

    setBusy(false)
    if (error) { setErr('تعذر الحفظ — حاول مجددًا'); return }
    onSaved(person.full_name)
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{person.status === 'pending' ? 'تفعيل حساب' : 'تعديل صلاحيات'}: {person.full_name}</h2>
        <p className="sub" dir="ltr" style={{ textAlign: 'right' }}>{person.email}</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label>الدور</label>
          <select value={form.role_id} onChange={e => set('role_id', e.target.value)}>
            <option value="">— اختر الدور —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
          </select>
        </div>

        <div className="field">
          <label>الفريق (اختياري)</label>
          <select value={form.team_id ?? ''} onChange={e => set('team_id', e.target.value)}>
            <option value="">بدون فريق</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {isAgent && (
          <>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="rot" checked={form.in_rotation}
                onChange={e => set('in_rotation', e.target.checked)}
                style={{ width: 18, height: 18 }} />
              <label htmlFor="rot" style={{ marginBottom: 0 }}>يدخل في التوزيع التلقائي للليدات</label>
            </div>

            {form.in_rotation && (
              <div className="grid-2">
                <div className="field">
                  <label>الوزن (1–10)</label>
                  <input type="number" min={1} max={10} value={form.weight}
                    onChange={e => set('weight', e.target.value)} />
                </div>
                <div className="field">
                  <label>الحد اليومي</label>
                  <input type="number" min={1} value={form.daily_cap}
                    onChange={e => set('daily_cap', e.target.value)} />
                </div>
              </div>
            )}

          </>
        )}

        {/* الهدف الشهري — لكل الأدوار (مبيعات ومنسقات) */}
        <div className="field">
          <label>الهدف الشهري (ريال)</label>
          <input type="number" min={0} value={form.monthly_target}
            onChange={e => set('monthly_target', e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : (person.status === 'pending' ? 'تفعيل الحساب' : 'حفظ التعديلات')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
