// قالب الفاتورة الضريبية المبسطة — صفحة HTML كاملة (A4) بالعربي والإنجليزي
// بتتعرض جوه iframe في نافذة الفاتورة، ومنها بتتطبع أو تتحفظ PDF
// البيانات المالية (الرقم، التاريخ، المبالغ، الـ QR، بيانات الشركة) لقطة ثابتة وقت الإصدار
// بيانات المريض والفرع والطبيب بتتقرا حيّة — عشان لو المنسقة كمّلت رقم الهوية بعد الإصدار يظهر في إعادة الطباعة
import qrcode from '../lib/vendor/qrcode-generator'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nl2br = (s) => esc(s).replace(/\n/g, '<br>')

const METHODS = {
  cash: ['نقدًا', 'Cash'], mada: ['مدى', 'Mada'], visa: ['فيزا', 'Visa'], mastercard: ['ماستركارد', 'Mastercard'],
  transfer: ['تحويل بنكي', 'Bank Transfer'], tabby: ['تابي', 'Tabby'], tamara: ['تمارا', 'Tamara'],
  card: ['شبكة', 'Card'], other: ['أخرى', 'Other'],
}
const GENDER = { male: ['ذكر', 'Male'], female: ['أنثى', 'Female'] }

// وقت الإصدار بتوقيت السعودية: 2026-10-16 01:30
function ksaDateTime(d) {
  if (!d) return ''
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(d)).reduce((a, x) => ({ ...a, [x.type]: x.value }), {})
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
function ksaDate(d) {
  return d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) : ''
}

function qrSvg(text) {
  if (!text) return ''
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
}

// خلية بيانات بعنوانين (عربي فوق، إنجليزي تحت) والقيمة
const cell = (ar, en, val, ltr = false) => `
  <div class="cell">
    <div class="lbl"><span>${ar}</span><span>${en}</span></div>
    <div class="val"${ltr ? ' dir="ltr"' : ''}>${val ? esc(val) : '—'}</div>
  </div>`

// inv: صف الفاتورة بالـ joins (payments, deals → leads/procedure_types/doctors)
// extra: { stamp (data URL), paidToDate, sample }
export function buildInvoiceHtml(inv, extra = {}) {
  const s = inv.seller ?? {}
  const pay = inv.payments ?? {}
  const deal = inv.deals ?? {}
  const lead = deal.leads ?? {}
  const proc = deal.procedure_types ?? {}
  const branch = lead.branch ?? {}
  const m = METHODS[pay.method] ?? [pay.method ?? '', pay.method ?? '']
  const g = GENDER[lead.gender]
  const cancelled = inv.status === 'cancelled'
  const code = proc.id ? 'S' + String(proc.id).padStart(3, '0') : '—'
  const desc = [proc.name_ar, proc.name_en].filter(Boolean).join(' / ') || '—'
  const ageGender = [lead.age ? String(lead.age) : '', g ? `${g[0]} / ${g[1]}` : ''].filter(Boolean).join(' · ')
  const total = Number(deal.total_amount) || 0
  const paidToDate = extra.paidToDate ?? null
  const remaining = paidToDate == null ? null : Math.max(0, total - paidToDate)
  const contact = [
    s.phone && `<span>☎ <b dir="ltr">${esc(s.phone)}</b></span>`,
    s.email && `<span>✉ <b dir="ltr">${esc(s.email)}</b></span>`,
    s.website && `<span>🌐 <b dir="ltr">${esc(s.website)}</b></span>`,
  ].filter(Boolean).join('')

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inv.invoice_no)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9ecf1; }
  body {
    font-family: 'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif;
    color: #1b2433; font-size: 11.5px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    position: relative; width: 210mm; min-height: 297mm; margin: 12px auto; padding: 12mm 12mm 10mm;
    background: #fff; box-shadow: 0 2px 14px rgba(20, 30, 50, .12); overflow: hidden;
  }
  @media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; } }
  @media screen and (max-width: 820px) { .page { width: 100%; min-height: 0; margin: 0; padding: 18px 14px; box-shadow: none; } }

  .head { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: start; padding-bottom: 12px; border-bottom: 2px solid #1b2433; }
  .seller-ar { text-align: right; }
  .seller-en { text-align: left; direction: ltr; }
  .seller-ar .nm, .seller-en .nm { font-size: 15px; font-weight: 700; }
  .seller-ar .ad, .seller-en .ad { color: #5a6577; font-size: 10.5px; margin-top: 2px; }
  .ids { text-align: center; font-size: 10.5px; color: #3c4658; white-space: nowrap; }
  .ids b { font-family: Menlo, Consolas, monospace; font-size: 12px; color: #1b2433; }
  .ids div + div { margin-top: 3px; }

  .title { display: flex; justify-content: space-between; align-items: baseline; margin: 14px 0 10px; }
  .title h1 { margin: 0; font-size: 19px; font-weight: 700; }
  .title .en { direction: ltr; font-size: 15px; font-weight: 600; color: #3c4658; }

  .info { display: grid; grid-template-columns: 1fr 128px; gap: 12px; border: 1.5px solid #1b2433; border-radius: 6px; padding: 10px 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 14px; }
  .cell .lbl { display: flex; justify-content: space-between; gap: 6px; font-size: 9.5px; color: #6b7588; }
  .cell .lbl span:last-child { direction: ltr; }
  .cell .val { font-weight: 600; font-size: 12px; border-bottom: 1px dotted #c8ced8; padding: 1px 0 3px; min-height: 20px; word-break: break-word; }
  .qr { width: 128px; height: 128px; align-self: center; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qr svg rect[fill="white"], .qr svg rect[fill="#ffffff"] { fill: #fff; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
  table.items th { background: #eef1f6; color: #1b2433; font-weight: 600; padding: 6px 6px; border: 1px solid #b9c1ce; vertical-align: top; }
  table.items th small { display: block; font-weight: 500; color: #5a6577; direction: ltr; }
  table.items td { padding: 8px 6px; border: 1px solid #b9c1ce; text-align: center; }
  table.items td.desc { text-align: right; }
  table.items td.num { font-family: Menlo, Consolas, monospace; direction: ltr; white-space: nowrap; }
  table.items tfoot td { font-weight: 700; background: #f7f8fb; }

  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px; align-items: start; }
  .box { border: 1px solid #b9c1ce; border-radius: 6px; padding: 8px 10px; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 4px 0; border-bottom: 1px dotted #d5dae3; }
  .row:last-child { border-bottom: 0; }
  .row .k { color: #3c4658; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .row .k small { color: #7b8496; direction: ltr; }
  .row .v { font-family: Menlo, Consolas, monospace; direction: ltr; font-weight: 600; white-space: nowrap; }
  .row .v.txt { font-family: inherit; direction: rtl; }
  .row.grand { background: #1b2433; color: #fff; border-radius: 4px; padding: 6px 8px; margin-top: 4px; }
  .row.grand .k, .row.grand .k small { color: #fff; }
  .box h3 { margin: 0 0 4px; font-size: 11px; color: #5a6577; font-weight: 600; display: flex; justify-content: space-between; }
  .box h3 span:last-child { direction: ltr; }

  .terms { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; font-size: 9.5px; color: #4a5468; line-height: 1.6; }
  .terms .en { direction: ltr; text-align: left; }
  .foot { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: end; margin-top: 16px; padding-top: 10px; border-top: 1px solid #c8ced8; }
  .contact { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 10.5px; color: #3c4658; }
  .stamp { width: 120px; height: 120px; opacity: .92; transform: rotate(-8deg); }
  .stamp img { width: 100%; height: 100%; object-fit: contain; }
  .sys { font-size: 9px; color: #8a93a5; margin-top: 6px; }

  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .wm span { transform: rotate(-28deg); font-size: 92px; font-weight: 800; color: rgba(200, 30, 40, .16); border: 8px solid rgba(200, 30, 40, .16); padding: 6px 28px; border-radius: 16px; white-space: nowrap; }
  .cancel-note { margin-top: 10px; padding: 8px 10px; border: 1px solid #e3a6aa; background: #fdf1f2; color: #a3242d; border-radius: 6px; font-size: 11px; }
  @media screen and (max-width: 600px) {
    .head { grid-template-columns: 1fr; text-align: center; }
    .seller-ar, .seller-en { text-align: center; }
    .info { grid-template-columns: 1fr; }
    .qr { justify-self: center; }
    .grid { grid-template-columns: 1fr 1fr; }
    .bottom, .terms { grid-template-columns: 1fr; }
    table.items { font-size: 10px; }
    .wm span { font-size: 44px; }
  }
</style>
</head>
<body>
<div class="page">
  ${cancelled ? '<div class="wm"><span>ملغاة · VOID</span></div>' : ''}
  ${extra.sample ? '<div class="wm"><span>معاينة · SAMPLE</span></div>' : ''}

  <div class="head">
    <div class="seller-ar">
      <div class="nm">${esc(s.name_ar)}</div>
      <div class="ad">${esc(s.address_ar)}</div>
    </div>
    <div class="ids">
      <div>الرقم الضريبي · VAT No.<br><b>${esc(s.vat_no)}</b></div>
      ${s.cr_no ? `<div>السجل التجاري · CR No.<br><b>${esc(s.cr_no)}</b></div>` : ''}
    </div>
    <div class="seller-en">
      <div class="nm">${esc(s.name_en)}</div>
      <div class="ad">${esc(s.address_en)}</div>
    </div>
  </div>

  <div class="title">
    <h1>فاتورة ضريبية مبسطة</h1>
    <div class="en">Simplified Tax Invoice</div>
  </div>

  <div class="info">
    <div class="grid">
      ${cell('رقم الفاتورة', 'Invoice No.', inv.invoice_no, true)}
      ${cell('تاريخ الفاتورة', 'Invoice Date', ksaDateTime(inv.issued_at), true)}
      ${cell('رقم الإيصال', 'Receipt No.', pay.receipt_no, true)}
      ${cell('اسم المريض', 'Patient Name', lead.full_name)}
      ${cell('رقم الملف', 'File No.', lead.file_no, true)}
      ${cell('رقم الهوية / الإقامة', 'National ID / Iqama', lead.national_id, true)}
      ${cell('الجنسية', 'Nationality', lead.nationality)}
      ${cell('العمر / الجنس', 'Age / Gender', ageGender)}
      ${cell('الجوال', 'Mobile', lead.phone, true)}
      ${cell('الفرع', 'Branch', [branch.name, branch.name_en].filter(Boolean).join(' / '))}
      ${cell('الطبيب المعالج', 'Treating Physician', deal.doctors?.full_name)}
      ${cell('تاريخ الدفع', 'Payment Date', ksaDate(pay.paid_at), true)}
    </div>
    <div class="qr">${qrSvg(inv.qr_tlv)}</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>كود الخدمة<small>Code</small></th>
        <th style="width:38%">وصف الخدمة<small>Description</small></th>
        <th>الكمية<small>Qty</small></th>
        <th>المبلغ قبل الضريبة<small>Amount excl. VAT</small></th>
        <th>الضريبة<small>VAT</small></th>
        <th>الإجمالي شامل الضريبة<small>Total incl. VAT</small></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="num">${esc(code)}</td>
        <td class="desc">${esc(desc)}${deal.grafts ? ` <span style="color:#6b7588">· ${esc(deal.grafts)} graft</span>` : ''}</td>
        <td class="num">1</td>
        <td class="num">${money(inv.subtotal)}</td>
        <td class="num">${money(inv.vat_amount)}</td>
        <td class="num">${money(inv.amount)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right">الإجمالي · Total (SAR)</td>
        <td class="num">${money(inv.subtotal)}</td>
        <td class="num">${money(inv.vat_amount)}</td>
        <td class="num">${money(inv.amount)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="bottom">
    <div class="box">
      <div class="row"><span class="k">طريقة الدفع<small>Payment Mode</small></span><span class="v txt">${esc(m[0])} · ${esc(m[1])}</span></div>
      ${pay.reference ? `<div class="row"><span class="k">مرجع العملية<small>Reference</small></span><span class="v">${esc(pay.reference)}</span></div>` : ''}
      <div class="row"><span class="k">المحصِّل<small>Collected By</small></span><span class="v txt">${esc(pay.received?.full_name ?? '—')}</span></div>
      ${total > 0 ? `
      <div class="row"><span class="k">قيمة التعاقد<small>Contract Value</small></span><span class="v">${money(total)}</span></div>
      ${paidToDate != null ? `
      <div class="row"><span class="k">المدفوع حتى تاريخه<small>Paid to Date</small></span><span class="v">${money(paidToDate)}</span></div>
      <div class="row"><span class="k">المتبقي<small>Balance</small></span><span class="v">${money(remaining)}</span></div>` : ''}` : ''}
    </div>
    <div class="box">
      <h3><span>ملخص الفاتورة</span><span>Summary (SAR)</span></h3>
      <div class="row"><span class="k">الإجمالي قبل الضريبة<small>Subtotal</small></span><span class="v">${money(inv.subtotal)}</span></div>
      <div class="row"><span class="k">ضريبة القيمة المضافة<small>VAT</small></span><span class="v">${money(inv.vat_amount)}</span></div>
      <div class="row grand"><span class="k">الإجمالي المستحق<small>Total Amount</small></span><span class="v">${money(inv.amount)}</span></div>
    </div>
  </div>

  ${cancelled ? `<div class="cancel-note">هذه الفاتورة ملغاة · This invoice has been voided${inv.cancel_reason ? ` — ${esc(inv.cancel_reason)}` : ''}</div>` : ''}

  ${(s.terms_ar || s.terms_en) ? `
  <div class="terms">
    <div>${nl2br(s.terms_ar)}</div>
    <div class="en">${nl2br(s.terms_en)}</div>
  </div>` : ''}

  <div class="foot">
    <div>
      ${contact ? `<div class="contact">${contact}</div>` : ''}
      <div class="sys">فاتورة إلكترونية صادرة من النظام · System-generated e-invoice — ${esc(inv.invoice_no)}</div>
    </div>
    ${s.show_stamp !== false && extra.stamp ? `<div class="stamp"><img src="${esc(extra.stamp)}" alt=""></div>` : ''}
  </div>
</div>
</body>
</html>`
}

// الاستعلام اللي بيجيب الفاتورة بكل اللي القالب محتاجه
export const INVOICE_SELECT = `
  id, invoice_no, issued_at, amount, vat_amount, subtotal, seller, qr_tlv, status, cancel_reason, cancelled_at, payment_id,
  payments(id, receipt_no, method, paid_at, reference, amount, status,
           received:profiles!payments_received_by_fkey(full_name)),
  deals(id, total_amount, grafts,
        procedure_types(id, name_ar, name_en),
        doctors(full_name),
        leads(file_no, full_name, phone, age, national_id, nationality, gender,
              branch:branches!leads_branch_id_fkey(name, name_en)))
`
