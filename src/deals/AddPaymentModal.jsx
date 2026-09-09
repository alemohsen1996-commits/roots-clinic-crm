// تسجيل دفعة جديدة
// يعرض المتبقي على الديل فور اختياره، ويقبل قسطًا محدد مسبقًا (من صفحة الأقساط)
// التسجيل يتم عبر record_payment: الدفعة وتحديث القسط في عملية واحدة لا تتجزأ
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'

export default function AddPaymentModal({ preset, onClose, onSaved }) {
  // preset اختياري: { deal_id, amount, installment_id, client, installment_label }
  const [deals, setDeals] = useState([])
  const [form, setForm] = useState({
    deal_id: preset?.deal_id ?? '',
    amount: preset?.amount ?? '',
    method: 'cash',
    reference: '',
    notes: '',
  })
  const [fin, setFin] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // الديلات المتاحة (عليها متبقٍ) — RLS تُظهر للمنسقة ديلاتها فقط
  useEffect(() => {
    supabase
      .from('v_deal_finance')
      .select('deal_id, net_amount, due_amount, collected, remaining')
      .gt('remaining', 0)
      .then(async ({ data }) => {
        const ids = (data ?? []).map(d => d.deal_id)
        if (!ids.length) { setDeals([]); return }
        const { data: dd } = await supabase
          .from('deals')
          .select('id, leads(file_no, full_name)')
          .in('id', ids)
          .in('status', ['active', 'waiting', 'done'])
        const finMap = Object.fromEntries((data ?? []).map(f => [f.deal_id, f]))
        setDeals((dd ?? []).map(d => ({ ...d, fin: finMap[d.id] })))
      })
  }, [])

  // تحديث المتبقي عند اختيار الديل
  useEffect(() => {
    const d = deals.find(x => x.id === Number(form.deal_id))
    setFin(d?.fin ?? null)
  }, [form.deal_id, deals])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const partial = preset?.installment_id
    && Number(form.amount) > 0
    && Number(form.amount) < Number(preset.amount ?? 0)

  async function save() {
    if (!form.deal_id) { setErr('اختر الديل'); return }
    if (!form.amount || Number(form.amount) <= 0) { setErr('أدخل المبلغ'); return }
    if (fin && Number(form.amount) > Number(fin.remaining)) {
      setErr(`المبلغ أكبر من المتبقي (${fmtNum(fin.remaining)} ر.س)`); return
    }
    setErr(''); setBusy(true)

    // دالة واحدة: تسجّل الدفعة وتحدّث القسط معًا — أو لا يحدث شيء
    const { error } = await supabase.rpc('record_payment', {
      p_deal_id: Number(form.deal_id),
      p_amount: Number(form.amount),
      p_method: form.method,
      p_reference: form.reference || null,
      p_notes: form.notes || null,
      p_installment_id: preset?.installment_id ?? null,
    })

    setBusy(false)
    if (error) {
      setErr(error.message?.includes('القسط')
        ? error.message
        : 'تعذر تسجيل الدفعة — ' + (error.message || 'تأكد من صلاحيتك على هذا الديل'))
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>تسجيل دفعة</h2>
        <p className="sub">سيُنشأ رقم إيصال تلقائيًا (RC-…)</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label>الديل</label>
          {preset?.deal_id ? (
            <input value={preset.client ?? `ديل #${preset.deal_id}`} disabled />
          ) : (
            <select value={form.deal_id} onChange={e => set('deal_id', e.target.value)}>
              <option value="">— اختر —</option>
              {deals.map(d => (
                <option key={d.id} value={d.id}>
                  {d.leads?.full_name} · {d.leads?.file_no} · متبقٍ {fmtNum(d.fin?.remaining)} ر.س
                </option>
              ))}
            </select>
          )}
        </div>

        {preset?.installment_id && (
          <div className="alert alert-ok" style={{ marginBottom: 14 }}>
            هذه الدفعة ستُسجَّل على {preset.installment_label ?? `القسط #${preset.installment_id}`}
            {' '}— المستحق عليه {fmtNum(preset.amount)} ر.س
          </div>
        )}

        {fin && (
          <div className="fin-grid" style={{ marginBottom: 16 }}>
            <div><span>المطلوب من العميل</span>{fmtNum(fin.due_amount ?? fin.net_amount)} ر.س</div>
            <div><span>المحصّل</span>{fmtNum(fin.collected)} ر.س</div>
            <div className="fin-danger"><span>المتبقي</span>{fmtNum(fin.remaining)} ر.س</div>
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>المبلغ (ر.س)</label>
            <input type="number" min={1} value={form.amount}
              onChange={e => set('amount', e.target.value)} />
          </div>
          <div className="field">
            <label>طريقة الدفع</label>
            <select value={form.method} onChange={e => set('method', e.target.value)}>
              <option value="cash">نقدًا</option>
              <option value="card">شبكة</option>
              <option value="transfer">تحويل بنكي</option>
              <option value="tabby">تابي</option>
              <option value="tamara">تمارا</option>
              <option value="other">أخرى</option>
            </select>
          </div>
        </div>

        {partial && (
          <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            سداد جزئي — سيبقى القسط مفتوحًا بحالة «جزئي» بمتبقٍ
            {' '}{fmtNum(Number(preset.amount) - Number(form.amount))} ر.س
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>مرجع العملية (اختياري)</label>
            <input dir="ltr" value={form.reference}
              onChange={e => set('reference', e.target.value)}
              placeholder="رقم الحوالة / العملية" />
          </div>
          <div className="field">
            <label>ملاحظات</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ الدفعة'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
