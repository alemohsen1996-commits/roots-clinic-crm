// أنواع البيع — عمليات / جلسات علاج / منتجات
// التصنيف بيحدد: هل تتعد "عملية" في الأرقام، الخانات اللي تظهر في الديل، باقة البلازما، ومرحلة الليد بعد "تمت"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'

const KINDS = [
  { id: 'surgery',   label: 'عملية',        hint: 'تتعد في "العمليات" · تقنية وبصيلات وطبيب · باقة بلازما بعد شهر · الليد ← "تمت العملية"' },
  { id: 'treatment', label: 'جلسات علاج',  hint: 'إيراد بس (مش عملية) · طبيب من غير تقنية/بصيلات · باقة جلسات أول جلسة يوم الشراء · الليد ← "عميل خدمات"' },
  { id: 'product',   label: 'منتج',         hint: 'إيراد بس (مش عملية) · من غير طبيب ولا جلسات · الليد ← "عميل خدمات"' },
]
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.id, k.label]))

const EMPTY = { name_ar: '', kind: 'surgery', base_price: '' }

export default function SaleTypesTab() {
  const [rows, setRows] = useState([])
  const [usage, setUsage] = useState({})        // procedure_type_id → عدد الديلات اللي تمت
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)  // الصف الأصلي وقت التعديل
  const [confirmKind, setConfirmKind] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data, error }, { data: deals }] = await Promise.all([
      supabase.from('procedure_types').select('*').order('id'),
      supabase.from('deals').select('procedure_type_id').eq('status', 'done'),
    ])
    if (error) { setMsg({ ok: false, t: 'تعذر التحميل — ' + error.message }); return }
    setRows(data ?? [])
    const u = {}
    for (const d of deals ?? []) if (d.procedure_type_id) u[d.procedure_type_id] = (u[d.procedure_type_id] ?? 0) + 1
    setUsage(u)
  }, [])
  useEffect(() => { load() }, [load])

  const say = (ok, t) => { setMsg({ ok, t }); setTimeout(() => setMsg(null), 4000) }
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (k === 'kind') setConfirmKind(false) }

  function reset() { setEditing(null); setForm(EMPTY); setConfirmKind(false) }

  function startEdit(r) {
    setEditing(r); setMsg(null); setConfirmKind(false)
    setForm({ name_ar: r.name_ar ?? '', kind: r.kind ?? 'surgery', base_price: Number(r.base_price) > 0 ? String(r.base_price) : '' })
  }

  // تغيير تصنيف نوع عليه ديلات متممة بيغيّر أرقام الشهور القديمة — لازم تأكيد
  const kindChanged = editing && (editing.kind ?? 'surgery') !== form.kind
  const affected = editing ? usage[editing.id] ?? 0 : 0
  const needsConfirm = kindChanged && affected > 0

  async function save() {
    const name = form.name_ar.trim()
    if (!name) { say(false, 'اكتب اسم النوع'); return }
    if (rows.some(r => r.name_ar?.trim() === name && r.id !== editing?.id)) { say(false, 'الاسم ده موجود بالفعل'); return }
    const price = form.base_price === '' ? 0 : Number(form.base_price)
    if (!(price >= 0)) { say(false, 'السعر لازم يكون رقم'); return }
    if (needsConfirm && !confirmKind) { setConfirmKind(true); return }

    const payload = { name_ar: name, kind: form.kind, base_price: price }
    setBusy(true)
    const { error } = editing
      ? await supabase.from('procedure_types').update(payload).eq('id', editing.id)
      : await supabase.from('procedure_types').insert({ ...payload, code: `type_${Date.now()}`, is_active: true })
    setBusy(false)
    if (error) { say(false, 'تعذر الحفظ — ' + error.message); return }
    say(true, editing ? 'اتحفظ التعديل' : 'اتضاف النوع')
    reset(); load()
  }

  async function toggle(r) {
    setBusy(true)
    const { error } = await supabase.from('procedure_types').update({ is_active: !r.is_active }).eq('id', r.id)
    setBusy(false)
    if (error) { say(false, 'تعذر التغيير — ' + error.message); return }
    load()
  }

  const grouped = useMemo(() => KINDS.map(k => ({
    ...k, list: rows.filter(r => (r.kind ?? 'surgery') === k.id),
  })), [rows])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>أنواع البيع</h2>
          <div className="hint" style={{ marginTop: 4 }}>
            اللي بيظهر في "نوع البيع" في فورم الديل. النوع المعطّل بيختفي من الديلات الجديدة بس.
          </div>
        </div>
        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')} style={{ margin: 12 }}>{msg.t}</div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>الاسم</th><th>السعر الافتراضي</th><th>ديلات تمت</th><th>الحالة</th><th></th></tr>
            </thead>
            {grouped.map(g => (
              <tbody key={g.id}>
                <tr>
                  <td colSpan={5} style={{ background: 'var(--line-soft)', fontWeight: 800, fontSize: 13 }}>
                    {g.label} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>({fmtNum(g.list.length)})</span>
                  </td>
                </tr>
                {g.list.length === 0 ? (
                  <tr><td colSpan={5} style={{ color: 'var(--ink-soft)', fontSize: 13 }}>مفيش أنواع هنا لسه</td></tr>
                ) : g.list.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.45 }}>
                    <td style={{ fontWeight: 600 }}>{r.name_ar}</td>
                    <td>{Number(r.base_price) > 0 ? `${fmtNum(r.base_price)} ر.س` : '—'}</td>
                    <td>{fmtNum(usage[r.id] ?? 0)}</td>
                    <td>{r.is_active ? 'فعال' : 'معطل'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => startEdit(r)}>تعديل</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(r)}>
                        {r.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editing ? `تعديل: ${editing.name_ar}` : 'إضافة نوع'}</h2>

        <div className="field">
          <label>الاسم</label>
          <input value={form.name_ar} onChange={e => set('name_ar', e.target.value)}
            placeholder="مثال: شامبو علاجي" onKeyDown={e => e.key === 'Enter' && save()} />
        </div>

        <div className="field">
          <label>التصنيف</label>
          <select value={form.kind} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <small style={{ color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.6, display: 'block', marginTop: 6 }}>
            {KINDS.find(k => k.id === form.kind)?.hint}
          </small>
        </div>

        <div className="field">
          <label>السعر الافتراضي (اختياري)</label>
          <input type="number" min={0} value={form.base_price} onChange={e => set('base_price', e.target.value)}
            placeholder="بيتكتب لوحده في قيمة التعاقد" />
        </div>

        {needsConfirm && (
          <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>
            النوع ده عليه {fmtNum(affected)} ديل تمت. تغييره من "{KIND_LABEL[editing.kind ?? 'surgery']}" لـ
            "{KIND_LABEL[form.kind]}" هيغيّر عدد العمليات في الشهور اللي فاتت كمان
            (الإيراد مش هيتغير، ومراحل الليدات والباقات اللي اتفتحت مش هتتغير).
            {confirmKind && <strong> اضغط حفظ تاني للتأكيد.</strong>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className={'btn ' + (needsConfirm && confirmKind ? 'btn-danger' : 'btn-primary')} onClick={save} disabled={busy}>
            {busy ? '…' : needsConfirm && confirmKind ? 'تأكيد الحفظ' : editing ? 'حفظ' : 'إضافة'}
          </button>
          {editing && <button className="btn btn-ghost" onClick={reset} disabled={busy}>إلغاء</button>}
        </div>
      </div>
    </div>
  )
}
