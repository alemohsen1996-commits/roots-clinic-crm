// إنشاء ديل جديد — يختار ليدًا في مرحلة "الديل" ثم يسجل التعاقد
// المنسقة والفرع إجباريين، والمنسقة مقفولة على نفسها إذا كان المستخدم منسقة
// الضريبة تُخصم من المبلغ المستلم للوصول إلى صافي العيادة
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum } from '../lib/format'
import { STAGE } from '../lib/stageCodes'
import { kindOf, dateLabel } from './useDealRefs'
import ProcedureOptions from './ProcedureOptions'
import useT from '../i18n/useT'

export default function NewDealModal({ refs, preloadLeadId, onClose, onSaved }) {
  const { profile, roleCode } = useAuth()
  const { t, dn, isEn } = useT()
  const isCoordinator = roleCode === 'coordinator'

  const [dealLeads, setDealLeads] = useState([])   // ليدات في مرحلة الديل بلا ديل نشط
  const [form, setForm] = useState({
    lead_id: preloadLeadId ?? '',
    // المنسقة تسجّل باسمها دائمًا ولا تختار غيرها
    coordinator_id: isCoordinator ? profile.id : '',
    branch_id: '',
    procedure_type_id: '',
    technique_id: '',
    doctor_id: '',
    grafts: '',
    total_amount: '',
    tax_amount: '0',
    tax_note: '',
    operation_date: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [branches, setBranches] = useState([])

  useEffect(() => {
    supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  // الليدات المؤهلة: في مرحلة "ديل" أو "عملية إضافية"، وليس لها ديل نشط حاليًا
  useEffect(() => {
    ;(async () => {
      const { data: stages } = await supabase
        .from('stages').select('id, code').in('code', [STAGE.DEAL, STAGE.REPEAT_PROCEDURE])
      const stageIds = (stages ?? []).map(s => s.id)
      if (!stageIds.length) return

      const { data: leads } = await supabase
        .from('leads')
        .select('id, file_no, full_name, owner_id, coordinator_id, branch_id')
        .in('stage_id', stageIds)
        .order('last_activity', { ascending: false })

      const { data: activeDeals } = await supabase
        .from('deals').select('lead_id').in('status', ['active', 'waiting'])
      const taken = new Set((activeDeals ?? []).map(d => d.lead_id))

      // عدد العمليات اللي تمت فعلًا — نفس منطق الترقيم في الداتابيز
      const { data: pastDeals } = await supabase.from('deals').select('lead_id').eq('status', 'done')
      const counts = {}
      for (const d of pastDeals ?? []) counts[d.lead_id] = (counts[d.lead_id] ?? 0) + 1

      setDealLeads(
        (leads ?? [])
          .filter(l => !taken.has(l.id))
          .map(l => ({ ...l, past: counts[l.id] ?? 0 }))
      )
    })()
  }, [])

  // preload: عند الفتح المباشر من شاشة الليد
  useEffect(() => {
    if (!preloadLeadId) return
    supabase.from('leads')
      .select('id, file_no, full_name, owner_id, coordinator_id, branch_id')
      .eq('id', preloadLeadId).single()
      .then(({ data }) => {
        if (!data) return
        setDealLeads(prev =>
          prev.some(l => l.id === data.id) ? prev : [{ ...data, past: 0 }, ...prev])
        setForm(f => ({
          ...f,
          lead_id: data.id,
          branch_id: data.branch_id ? String(data.branch_id) : f.branch_id,
          coordinator_id: isCoordinator
            ? profile.id
            : (f.coordinator_id || data.coordinator_id || ''),
        }))
      })
  }, [preloadLeadId, isCoordinator, profile.id])

  // فرع العميل: يتملّى تلقائي من ملف الليد لو محدد
  useEffect(() => {
    if (!form.lead_id) return
    const l = dealLeads.find(x => x.id === Number(form.lead_id))
    setForm(f => ({ ...f, branch_id: l?.branch_id ? String(l.branch_id) : '' }))
  }, [form.lead_id, dealLeads])

  // تحديد المنسقة تلقائيًا من الليد المختار — لا يُطبَّق على المنسقة نفسها
  useEffect(() => {
    if (isCoordinator || !form.lead_id) return
    const l = dealLeads.find(x => x.id === Number(form.lead_id))
    if (l?.coordinator_id) {
      setForm(f => ({ ...f, coordinator_id: f.coordinator_id || l.coordinator_id }))
    }
  }, [form.lead_id, dealLeads, isCoordinator])

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    // اختيار نوع ليه سعر افتراضي → يتكتب في قيمة التعاقد لو لسه فاضية
    if (k === 'procedure_type_id' && !f.total_amount) {
      const price = Number(refs.procedures.find(p => String(p.id) === String(v))?.base_price ?? 0)
      if (price > 0) next.total_amount = String(price)
    }
    return next
  })
  // نوع البيع المختار: عملية / جلسات علاج / منتج — بيحدد الخانات اللي تظهر
  const kind = kindOf(refs.procedures, form.procedure_type_id)

  const total = Number(form.total_amount || 0)
  const tax = Number(form.tax_amount || 0)
  const net = total - tax
  const hasTax = tax > 0
  const taxTooBig = hasTax && tax >= total && total > 0

  const myName = useMemo(
    () => refs.coordinators.find(c => c.id === profile.id)?.full_name ?? profile.full_name,
    [refs.coordinators, profile]
  )

  async function save() {
    if (!form.lead_id) { setErr(t('newDeal.err.pickClient')); return }
    if (!form.coordinator_id) { setErr(t('newDeal.err.coordRequired')); return }
    if (!form.branch_id) { setErr(t('newDeal.err.branchRequired')); return }
    if (!total || total <= 0) { setErr(t('newDeal.err.amountRequired')); return }
    if (taxTooBig) { setErr(t('newDeal.err.taxTooBig')); return }
    setErr(''); setBusy(true)

    const selected = dealLeads.find(l => l.id === Number(form.lead_id))
    const lead = selected ?? { owner_id: profile.id }

    // الفرع بيتسجّل في ملف الليد (هو مصدر الفرع في الكشوف والتقارير)
    if (String(selected?.branch_id ?? '') !== form.branch_id) {
      const { error: bErr } = await supabase.from('leads')
        .update({ branch_id: Number(form.branch_id) }).eq('id', Number(form.lead_id))
      if (bErr) { setBusy(false); setErr(t('newDeal.err.branchSetFailed') + ' — ' + bErr.message); return }
    }

    const { error } = await supabase.from('deals').insert({
      lead_id: Number(form.lead_id),
      // procedure_no بيتحسب تلقائي في الداتابيز (trg_deal_procedure_no)
      agent_id: lead.owner_id ?? profile.id,     // صاحب الإيراد = مالك الليد
      coordinator_id: form.coordinator_id,
      procedure_type_id: form.procedure_type_id ? Number(form.procedure_type_id) : null,
      // التقنية والبصيلات للعمليات بس، والطبيب لغير المنتجات
      technique_id: kind === 'surgery' && form.technique_id ? Number(form.technique_id) : null,
      doctor_id: kind !== 'product' && form.doctor_id ? Number(form.doctor_id) : null,
      grafts: kind === 'surgery' && form.grafts ? Number(form.grafts) : null,
      total_amount: total,
      tax_amount: tax,
      tax_note: form.tax_note || null,
      operation_date: form.operation_date || null,
    })

    setBusy(false)
    if (error) {
      setErr(error.message.includes('uq_deals_active_lead')
        ? t('newDeal.err.activeExists')
        : t('addLead.saveFailed') + ' — ' + error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <h2>{t('newDeal.title')}</h2>
        <p className="sub">{t('newDeal.sub')}</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label>{t('newDeal.clientLabel')}</label>
          <select value={form.lead_id} onChange={e => set('lead_id', e.target.value)}>
            <option value="">{t('newDeal.pickClient')}</option>
            {dealLeads.map(l => (
              <option key={l.id} value={l.id}>
                {l.full_name} · {l.file_no}{l.past > 0 ? ` — ${t('newDeal.operationNo', { n: l.past + 1 })}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('lead.branch')} *</label>
          <select value={form.branch_id} onChange={e => set('branch_id', e.target.value)}>
            <option value="">{t('addLead.pickBranch')}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
          </select>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('lead.coordinator')} *</label>
            {isCoordinator ? (
              <>
                <input value={myName} disabled />
                <small style={{ color: 'var(--ink-soft)' }}>
                  {t('newDeal.coordSelfNote')}
                </small>
              </>
            ) : (
              <select value={form.coordinator_id} onChange={e => set('coordinator_id', e.target.value)}>
                <option value="">{t('common.pick')}</option>
                {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            )}
          </div>
          <div className="field">
            <label>{t('deal.saleType')}</label>
            <select value={form.procedure_type_id} onChange={e => set('procedure_type_id', e.target.value)}>
              <option value="">—</option>
              <ProcedureOptions procedures={refs.procedures} />
            </select>
          </div>
        </div>

        {kind === 'surgery' && (
        <div className="grid-2">
          <div className="field">
            <label>{t('deal.technique')}</label>
            <select value={form.technique_id} onChange={e => set('technique_id', e.target.value)}>
              <option value="">—</option>
              {refs.techniques.map(tq => (
                <option key={tq.id} value={tq.id}>
                  {tq.name}{tq.name_ar && !isEn ? ` — ${tq.name_ar}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('deal.grafts')}</label>
            <input type="number" min={0} value={form.grafts}
              onChange={e => set('grafts', e.target.value)} />
          </div>
        </div>
        )}

        {kind !== 'product' && (
        <div className="field">
          <label>{t('deal.doctor')}</label>
          <select value={form.doctor_id} onChange={e => set('doctor_id', e.target.value)}>
            <option value="">—</option>
            {refs.doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>{t('deal.contractAmount')} ({t('common.currency')}) *</label>
            <input type="number" min={0} value={form.total_amount}
              onChange={e => set('total_amount', e.target.value)}
              placeholder={t('newDeal.amountPh')} />
          </div>
          <div className="field">
            <label>{t('deal.tax')} ({t('common.currency')})</label>
            <input type="number" min={0} value={form.tax_amount}
              onChange={e => set('tax_amount', e.target.value)} />
          </div>
        </div>

        {total > 0 && (
          <div className="fin-grid" style={{ marginBottom: 16 }}>
            <div><span>{t('deal.receivedFromClient')}</span>{fmtNum(total)} {t('common.currency')}</div>
            <div><span>{t('deal.tax')}</span>{fmtNum(tax)} {t('common.currency')}</div>
            <div className="fin-gold"><span>{t('deal.clinicNet')}</span>{fmtNum(net > 0 ? net : 0)} {t('common.currency')}</div>
          </div>
        )}

        {taxTooBig && (
          <div className="alert alert-error">
            {t('newDeal.taxTooBigNote')}
          </div>
        )}

        {hasTax && !taxTooBig && (
          <div className="field">
            <label>{t('deal.taxNoteOptional')}</label>
            <input value={form.tax_note}
              onChange={e => set('tax_note', e.target.value)}
              placeholder={t('newDeal.taxNotePh')} />
          </div>
        )}

        <div className="field">
          <label>{dateLabel(kind)}</label>
          <input type="date" value={form.operation_date}
            onChange={e => set('operation_date', e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('newDeal.create')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
