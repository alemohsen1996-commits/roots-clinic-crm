// إضافة ليد يدويًا — مع كشف التكرار الفوري بالهاتف
// + خانات العمر والمهنة والفرع
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

export default function AddLeadModal({ refs, onClose, onSaved }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({
    full_name: '', phone: '', country: '', city: '',
    age: '', occupation: '', branch_id: '',
    source_id: '', procedure_interest: '', notes: '',
  })
  const [branches, setBranches] = useState([])
  const [dup, setDup] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // جلب الفروع النشطة
  useEffect(() => {
    supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function checkDup() {
    if (form.phone.replace(/\D/g, '').length < 8) { setDup(null); return }
    const { data } = await supabase.rpc('check_duplicate_phone', { p_phone: form.phone })
    setDup(data?.length ? data[0] : null)
  }

  async function save() {
    if (!form.full_name.trim() || !form.phone.trim()) {
      setErr('الاسم والهاتف مطلوبان'); return
    }
    if (dup) { setErr('هذا الرقم مسجل بالفعل — افتح الملف الموجود بدلًا من التكرار'); return }
    setErr(''); setBusy(true)

    const newStage = refs.stages.find(s => s.code === 'new')
    const manualSource = refs.sources.find(s => s.code === 'manual')

    const { error } = await supabase.from('leads').insert({
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      country: form.country || null,
      city: form.city || null,
      age: form.age ? Number(form.age) : null,
      occupation: form.occupation || null,
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      source_id: form.source_id ? Number(form.source_id) : manualSource?.id,
      procedure_interest: form.procedure_interest || null,
      notes: form.notes || null,
      stage_id: newStage?.id,
      owner_id: profile.id,
      created_by: profile.id,
    })

    setBusy(false)
    if (error) {
      setErr(error.message.includes('uq_leads_phone')
        ? 'هذا الرقم مسجل بالفعل في النظام'
        : 'تعذر الحفظ — تأكد من البيانات')
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>ليد جديد</h2>
        <p className="sub">إضافة يدوية — سيُسند إليك تلقائيًا</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="grid-2">
          <div className="field">
            <label>الاسم الكامل *</label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
          <div className="field">
            <label>الهاتف *</label>
            <input dir="ltr" value={form.phone}
              onChange={e => set('phone', e.target.value)}
              onBlur={checkDup}
              placeholder="+9665xxxxxxxx" />
          </div>
        </div>

        {dup && (
          <div className="alert alert-error">
            الرقم مسجل باسم <b>{dup.full_name}</b> (ملف {dup.file_no}) —
            المرحلة: {dup.stage} · المسؤول: {dup.owner ?? 'غير مسند'}
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>العمر</label>
            <input type="number" min={0} max={120} value={form.age}
              onChange={e => set('age', e.target.value)} placeholder="مثال: 32" />
          </div>
          <div className="field">
            <label>المهنة</label>
            <input value={form.occupation} onChange={e => set('occupation', e.target.value)}
              placeholder="مثال: مهندس" />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>الفرع</label>
            <select value={form.branch_id} onChange={e => set('branch_id', e.target.value)}>
              <option value="">— اختر الفرع —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>المصدر</label>
            <select value={form.source_id} onChange={e => set('source_id', e.target.value)}>
              <option value="">إضافة يدوية</option>
              {refs.sources.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>الدولة</label>
            <input value={form.country} onChange={e => set('country', e.target.value)} />
          </div>
          <div className="field">
            <label>المدينة</label>
            <input value={form.city} onChange={e => set('city', e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>الاهتمام</label>
            <select value={form.procedure_interest} onChange={e => set('procedure_interest', e.target.value)}>
              <option value="">—</option>
              <option value="hair">زراعة شعر</option>
              <option value="beard">لحية</option>
              <option value="eyebrows">حواجب</option>
              <option value="prp">بلازما</option>
            </select>
          </div>
          <div className="field">
            <label>ملاحظات</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !!dup}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ الليد'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
