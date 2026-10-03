// إضافة ليد يدويًا — مع كشف التكرار الفوري بالهاتف
// + خانات العمر والمهنة والفرع
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { STAGE } from '../lib/stageCodes'
import useT from '../i18n/useT'

// توحيد الأرقام السعودية للصيغة الدولية (+9665XXXXXXXX)
// فيتساوى «05…» و«5…» و«9665…» مع «+9665…» ويتمنع تكرار نفس الرقم بصيغتين.
// الأرقام غير السعودية المعروفة تُترك كما هي.
export function canonSaudiPhone(raw) {
  const orig = (raw || '').trim()
  let d = orig.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (/^0?5\d{8}$/.test(d)) return '+966' + d.replace(/^0/, '')  // 05XXXXXXXX أو 5XXXXXXXX
  if (/^9665\d{8}$/.test(d)) return '+' + d                       // 9665XXXXXXXX
  return orig                                                     // مش سعودي معروف — يُترك كما هو
}

export default function AddLeadModal({ refs, onClose, onSaved }) {
  const { profile } = useAuth()
  const { t, dn } = useT()
  const [form, setForm] = useState({
    full_name: '', phone: '', country: '', city: '',
    age: '', occupation: '', branch_id: '', stage_id: '',
    source_id: '', procedure_interest: '', notes: '',
  })
  const [branches, setBranches] = useState([])
  const [dup, setDup] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // جلب الفروع النشطة
  useEffect(() => {
    supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  // المراحل المتاحة عند الإنشاء اليدوي: بورد المبيعات فقط
  const salesStages = refs.stages.filter(s => (s.board ?? 'sales') === 'sales')

  // المرحلة الافتراضية = "جديد" (تُضبط مرة عند توفّر المراجع)
  useEffect(() => {
    const n = refs.stages.find(s => s.code === STAGE.NEW)
    if (n) setForm(f => (f.stage_id ? f : { ...f, stage_id: String(n.id) }))
  }, [refs.stages])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function checkDup() {
    const canon = canonSaudiPhone(form.phone)
    if (canon !== form.phone) set('phone', canon)   // يعرض الصيغة الموحّدة للموظف
    if (canon.replace(/\D/g, '').length < 8) { setDup(null); return }
    const { data } = await supabase.rpc('check_duplicate_phone', { p_phone: canon })
    setDup(data?.length ? data[0] : null)
  }

  async function save() {
    const phone = canonSaudiPhone(form.phone)
    if (!form.full_name.trim() || !phone.trim()) {
      setErr(t('addLead.required')); return
    }
    if (dup) { setErr(t('addLead.dupErr')); return }
    setErr(''); setBusy(true)

    const newStage = refs.stages.find(s => s.code === STAGE.NEW)
    const manualSource = refs.sources.find(s => s.code === 'manual')

    const { error } = await supabase.from('leads').insert({
      full_name: form.full_name.trim(),
      phone: phone,
      country: form.country || null,
      city: form.city || null,
      age: form.age ? Number(form.age) : null,
      occupation: form.occupation || null,
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      source_id: form.source_id ? Number(form.source_id) : manualSource?.id,
      procedure_interest: form.procedure_interest || null,
      notes: form.notes || null,
      stage_id: form.stage_id ? Number(form.stage_id) : newStage?.id,
      owner_id: profile.id,
      created_by: profile.id,
    })

    setBusy(false)
    if (error) {
      setErr(error.message.includes('uq_leads_phone')
        ? t('addLead.dupDb')
        : t('addLead.saveFailed'))
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{t('leads.newLead')}</h2>
        <p className="sub">{t('addLead.sub')}</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.fullName')} *</label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
          <div className="field">
            <label>{t('lead.phone')} *</label>
            <input dir="ltr" value={form.phone}
              onChange={e => set('phone', e.target.value)}
              onBlur={checkDup}
              placeholder="+9665xxxxxxxx" />
          </div>
        </div>

        {dup && (
          <div className="alert alert-error">
            {t('addLead.dupRegisteredAs')} <b>{dup.full_name}</b> ({t('lead.fileNo')} {dup.file_no}) —
            {t('lead.stage')}: {dup.stage} · {t('lead.owner')}: {dup.owner ?? t('lead.unassigned')}
          </div>
        )}

        <div className="field">
          <label>{t('lead.stage')}</label>
          <select value={form.stage_id} onChange={e => set('stage_id', e.target.value)}>
            {salesStages.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
          </select>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.age')}</label>
            <input type="number" min={0} max={120} value={form.age}
              onChange={e => set('age', e.target.value)} placeholder={t('addLead.agePh')} />
          </div>
          <div className="field">
            <label>{t('lead.job')}</label>
            <input value={form.occupation} onChange={e => set('occupation', e.target.value)}
              placeholder={t('addLead.jobPh')} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.branch')}</label>
            <select value={form.branch_id} onChange={e => set('branch_id', e.target.value)}>
              <option value="">{t('addLead.pickBranch')}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t('lead.source')}</label>
            <select value={form.source_id} onChange={e => set('source_id', e.target.value)}>
              <option value="">{t('addLead.manualEntry')}</option>
              {refs.sources.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.country')}</label>
            <input value={form.country} onChange={e => set('country', e.target.value)} />
          </div>
          <div className="field">
            <label>{t('lead.city')}</label>
            <input value={form.city} onChange={e => set('city', e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.interest')}</label>
            <select value={form.procedure_interest} onChange={e => set('procedure_interest', e.target.value)}>
              <option value="">—</option>
              <option value="hair">{t('interest.hair')}</option>
              <option value="beard">{t('interest.beard')}</option>
              <option value="eyebrows">{t('interest.eyebrows')}</option>
              <option value="prp">{t('interest.prp')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('lead.notes')}</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !!dup}>
            {busy ? t('common.saving') : t('addLead.save')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
