// إعدادات الفاتورة — بيانات الشركة اللي بتظهر على الفاتورة الضريبية + الختم + الشروط
// المدير العام بس (سياسة جدول settings)
// التعديل هنا بيأثر على الفواتير الجديدة بس — كل فاتورة بتحتفظ بلقطة من بيانات الشركة وقت إصدارها
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dbErr } from '../lib/dbErrors'
import useT from '../i18n/useT'
import { buildInvoiceHtml } from '../finance/invoiceHtml'
import { printHtml, resetStampCache } from '../finance/InvoiceModal'

const EMPTY = {
  name_ar: '', name_en: '', vat_no: '', cr_no: '',
  address_ar: '', address_en: '', phone: '', email: '', website: '',
  terms_ar: '', terms_en: '', show_stamp: true,
}

// تصغير صورة الختم لـ 360px (PNG بشفافيتها) عشان تتخزن خفيفة
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')) }
    img.src = url
  })
}

export default function InvoiceTab() {
  const { t } = useT()
  const [f, setF] = useState(EMPTY)
  const [stamp, setStamp] = useState(null)
  const [msg, setMsg] = useState(null)   // { ok, t }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('key, value').in('key', ['invoice_seller', 'invoice_stamp'])
      .then(({ data }) => {
        const m = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
        setF({ ...EMPTY, ...(m.invoice_seller ?? {}) })
        setStamp(typeof m.invoice_stamp === 'string' ? m.invoice_stamp : null)
      })
  }, [])

  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const say = (ok, text) => { setMsg({ ok, t: text }); setTimeout(() => setMsg(null), 4000) }

  async function save() {
    if (!f.name_ar.trim() || !/^\d{15}$/.test(f.vat_no.trim())) { say(false, t('invSet.err.required')); return }
    setBusy(true)
    const seller = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const rows = [{ key: 'invoice_seller', value: seller }]
    rows.push({ key: 'invoice_stamp', value: stamp ?? '' })
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
    setBusy(false)
    if (error) { say(false, t('addLead.saveFailed') + ' — ' + dbErr(error.message)); return }
    resetStampCache()
    say(true, t('general.saved'))
  }

  async function pickStamp(file) {
    if (!file) return
    try { setStamp(await shrinkImage(file)) } catch { say(false, t('invSet.err.image')) }
  }

  function preview() {
    const now = new Date().toISOString()
    const html = buildInvoiceHtml({
      invoice_no: 'INV-0000-000000', issued_at: now, amount: 11500, vat_amount: 1500, subtotal: 10000,
      seller: f, qr_tlv: 'SAMPLE', status: 'issued',
      payments: { receipt_no: 'RC-0000-00000', method: 'mada', paid_at: now, received: { full_name: '—' } },
      deals: {
        total_amount: 11500, procedure_types: { id: 1, name_ar: 'زراعة شعر', name_en: 'Hair Transplant' },
        doctors: { full_name: '—' },
        leads: { full_name: 'اسم المريض', file_no: 'F-0000', phone: '+966500000000', age: 30,
                 national_id: '1000000000', nationality: 'السعودية', gender: 'male', branch: { name: 'جدة', name_en: 'Jeddah' } },
      },
    }, { stamp, paidToDate: 11500, sample: true })
    printHtml(html)
  }

  const input = (k, opts = {}) => (
    <div className="field">
      <label>{t(`invSet.f.${k}`)}{opts.req ? ' *' : ''}</label>
      {opts.area
        ? <textarea rows={5} dir={opts.ltr ? 'ltr' : undefined} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />
        : <input dir={opts.ltr ? 'ltr' : undefined} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />}
    </div>
  )

  return (
    <div className="card" style={{ padding: 20, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>{t('invSet.title')}</h3>
      <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: -4 }}>{t('invSet.hint')}</p>

      {msg && <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')}>{msg.t}</div>}

      <div className="inv-settings-grid">
        {input('name_ar', { req: true })}
        {input('name_en', { ltr: true })}
        {input('vat_no', { req: true, ltr: true })}
        {input('cr_no', { ltr: true })}
        {input('address_ar')}
        {input('address_en', { ltr: true })}
        {input('phone', { ltr: true })}
        {input('email', { ltr: true })}
        {input('website', { ltr: true })}
      </div>

      <div className="inv-settings-grid">
        {input('terms_ar', { area: true })}
        {input('terms_en', { area: true, ltr: true })}
      </div>

      <div className="field">
        <label>{t('invSet.f.stamp')}</label>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="inv-stamp-prev">
            {stamp ? <img src={stamp} alt="" /> : <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</span>}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              {stamp ? t('invSet.changeStamp') : t('invSet.uploadStamp')}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={e => { pickStamp(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {stamp && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setStamp(null)}>
                {t('invSet.removeStamp')}
              </button>
            )}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={f.show_stamp !== false}
                onChange={e => set('show_stamp', e.target.checked)} />
              {t('invSet.showStamp')}
            </label>
          </div>
        </div>
        <small style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{t('invSet.stampHint')}</small>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? t('common.saving') : t('common.save')}</button>
        <button className="btn btn-ghost" onClick={preview}>🖨 {t('invSet.preview')}</button>
      </div>
    </div>
  )
}
