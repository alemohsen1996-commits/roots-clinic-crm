// تسجيل دفعة جديدة
// يعرض المتبقي على الديل فور اختياره، ويقبل قسطًا محدد مسبقًا (من صفحة الأقساط)
// التسجيل يتم عبر record_payment_at: الدفعة وتحديث القسط في عملية واحدة لا تتجزأ
// صورة الإيصال إجبارية: بتترفع الأول، وبعدين الدفعة بتتسجل بمسارها
// تاريخ التحصيل: افتراضيًا النهارده، ويتغيّر لتاريخ قديم عند إدخال دفعات العمليات القديمة
// ضريبة الدفعة: المنسقة بتكتبها يدوي (المبلغ شامل الضريبة) — والفاتورة الضريبية بتطلع تلقائي وتتفتح بعد الحفظ
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum } from '../lib/format'
import { uploadReceipt, discardReceipt } from './receipts'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'
import InvoiceModal, { VatField } from './InvoiceModal'

// طرق الدفع للتسجيل الجديد ("شبكة" القديمة اتقسمت لمدى/فيزا/ماستركارد)
// الأسماء في الترجمة: payMethod.*
export const PAY_METHODS = ['cash', 'mada', 'visa', 'mastercard', 'transfer', 'tabby', 'tamara', 'other']

// تاريخ اليوم بتوقيت السعودية (YYYY-MM-DD) — نفس المرجع اللي الداتابيز بتتحقق بيه
const todayKSA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })

export default function AddPaymentModal({ preset, onClose, onSaved }) {
  const { profile } = useAuth()
  const { t } = useT()
  const SAR = t('common.currency')
  // preset اختياري: { deal_id, amount, installment_id, client, installment_label }
  const [deals, setDeals] = useState([])
  const [form, setForm] = useState({
    deal_id: preset?.deal_id ?? '',
    amount: preset?.amount ?? '',
    method: 'cash',
    reference: '',
    notes: '',
    paid_at: todayKSA(),
    vat: '',
  })
  const [invoiceId, setInvoiceId] = useState(null)   // الفاتورة اللي طلعت بعد الحفظ
  const [fin, setFin] = useState(null)
  const [file, setFile] = useState(null)
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // الديلات المتاحة (عليها متبقٍ) — RLS تُظهر للمنسقة ديلاتها فقط
  useEffect(() => {
    supabase
      .from('v_deal_finance')
      .select('deal_id, net_amount, collected, remaining')
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
    if (!form.deal_id) { setErr(t('payment.err.pickDeal')); return }
    if (!form.amount || Number(form.amount) <= 0) { setErr(t('payment.err.amount')); return }
    if (fin && Number(form.amount) > Number(fin.remaining)) {
      setErr(t('payment.err.exceeds', { n: fmtNum(fin.remaining), cur: SAR })); return
    }
    if (!form.paid_at) { setErr(t('payment.err.paidAt')); return }
    if (form.paid_at > todayKSA()) { setErr(t('payment.err.paidAtFuture')); return }
    if (form.vat === '' || Number(form.vat) < 0) { setErr(t('invoice.err.vat')); return }
    if (Number(form.vat) >= Number(form.amount)) { setErr(t('invoice.err.vatTooBig')); return }
    if (!file) { setErr(t('payment.err.receipt')); return }
    setErr(''); setBusy(true)

    // 1) رفع الإيصال
    let path
    try {
      path = await uploadReceipt(file, profile?.id)
    } catch (e) {
      setBusy(false); setErr(dbErr(e.message)); return
    }

    // 2) دالة واحدة: تسجّل الدفعة (بمسار الإيصال وضريبتها) وتحدّث القسط وتصدر الفاتورة — أو لا يحدث شيء
    const { data: paymentId, error } = await supabase.rpc('record_payment_v2', {
      p_deal_id: Number(form.deal_id),
      p_amount: Number(form.amount),
      p_method: form.method,
      p_vat: Number(form.vat),
      p_reference: form.reference || null,
      p_notes: form.notes || null,
      p_installment_id: preset?.installment_id ?? null,
      p_receipt_path: path,
      p_paid_at: form.paid_at,
    })

    setBusy(false)
    if (error) {
      discardReceipt(path)   // التسجيل فشل — نمسح الصورة اللي اترفعت
      setErr(error.message?.includes('القسط')
        ? dbErr(error.message)
        : t('payment.err.saveFailed') + ' — ' + (error.message ? dbErr(error.message) : t('payment.err.checkPerm')))
      return
    }
    // نفتح الفاتورة على طول عشان تتطبع للمريض — ولو ماطلعتش لأي سبب نقفل عادي
    const { data: inv } = await supabase.from('invoices').select('id')
      .eq('payment_id', paymentId).eq('status', 'issued').maybeSingle()
    if (inv?.id) setInvoiceId(inv.id)
    else onSaved()
  }

  if (invoiceId) return <InvoiceModal invoiceId={invoiceId} onClose={onSaved} />

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{t('payment.title')}</h2>
        <p className="sub">{t('payment.sub')}</p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label>{t('payment.deal')}</label>
          {preset?.deal_id ? (
            <input value={preset.client ?? t('dealDrawer.dealNo', { n: preset.deal_id })} disabled />
          ) : (
            <select value={form.deal_id} onChange={e => set('deal_id', e.target.value)}>
              <option value="">{t('common.pick')}</option>
              {deals.map(d => (
                <option key={d.id} value={d.id}>
                  {d.leads?.full_name} · {d.leads?.file_no} · {t('payment.remainingShort')} {fmtNum(d.fin?.remaining)} {SAR}
                </option>
              ))}
            </select>
          )}
        </div>

        {preset?.installment_id && (
          <div className="alert alert-ok" style={{ marginBottom: 14 }}>
            {t('payment.onInstallment', { label: preset.installment_label ?? t('payment.installmentNo', { n: preset.installment_id }) })}
            {' '}— {t('payment.dueOnIt')} {fmtNum(preset.amount)} {SAR}
          </div>
        )}

        {fin && (
          <div className="fin-grid" style={{ marginBottom: 16 }}>
            <div><span>{t('deals.sorts.net')}</span>{fmtNum(fin.net_amount)} {SAR}</div>
            <div><span>{t('common.collected')}</span>{fmtNum(fin.collected)} {SAR}</div>
            <div className="fin-danger"><span>{t('deals.sorts.remaining')}</span>{fmtNum(fin.remaining)} {SAR}</div>
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>{t('payment.amount')} ({SAR})</label>
            <input type="number" min={1} value={form.amount}
              onChange={e => set('amount', e.target.value)} />
          </div>
          <div className="field">
            <label>{t('payment.method')}</label>
            <select value={form.method} onChange={e => set('method', e.target.value)}>
              {PAY_METHODS.map(m => <option key={m} value={m}>{t(`payMethod.${m}`)}</option>)}
            </select>
          </div>
        </div>

        <VatField amount={form.amount} value={form.vat} onChange={v => set('vat', v)} />

        <div className="field">
          <label>{t('payment.paidAt')}</label>
          <input type="date" value={form.paid_at} max={todayKSA()}
            onChange={e => set('paid_at', e.target.value)} />
          {form.paid_at && form.paid_at < todayKSA() && (
            <small style={{ color: 'var(--warn)', fontSize: 12 }}>{t('payment.backdatedHint')}</small>
          )}
        </div>

        {partial && (
          <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {t('payment.partialNote')}
            {' '}{fmtNum(Number(preset.amount) - Number(form.amount))} {SAR}
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label>{t('payment.reference')}</label>
            <input dir="ltr" value={form.reference}
              onChange={e => set('reference', e.target.value)}
              placeholder={t('payment.referencePh')} />
          </div>
          <div className="field">
            <label>{t('lead.notes')}</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {/* صورة الإيصال — إجبارية */}
        <div className="field">
          <label>{t('payment.receiptImage')} <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input type="file" accept="image/*,application/pdf"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setErr('') }} />
          <small style={{ color: 'var(--ink-soft)', fontSize: 12 }}>
            {t('payment.receiptHint')}
          </small>
          {preview && (
            <img src={preview} alt={t('payment.receiptPreview')}
              style={{ marginTop: 8, maxHeight: 160, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
          )}
          {file && !preview && <div style={{ marginTop: 6, fontSize: 13 }}>📄 {file.name}</div>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? t('payment.uploading') : t('payment.save')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
