// أنواع البيع — عمليات / جلسات علاج / منتجات
// التصنيف بيحدد: هل تتعد "عملية" في الأرقام، الخانات اللي تظهر في الديل، باقة البلازما، ومرحلة الليد بعد "تمت"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

// الأسماء والشرح من الترجمة: saleTypes.kind.* / saleTypes.hint.*
const KINDS = ['surgery', 'treatment', 'product']

const EMPTY = { name_ar: '', name_en: '', kind: 'surgery', base_price: '' }

export default function SaleTypesTab() {
  const { t, dn } = useT()
  const KIND_LABEL = (k) => t(`saleTypes.kind.${k}`)
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
    if (error) { setMsg({ ok: false, t: t('settings.loadFailed') + ' — ' + dbErr(error.message) }); return }
    setRows(data ?? [])
    const u = {}
    for (const d of deals ?? []) if (d.procedure_type_id) u[d.procedure_type_id] = (u[d.procedure_type_id] ?? 0) + 1
    setUsage(u)
  }, [])
  useEffect(() => { load() }, [load])

  const say = (ok, text) => { setMsg({ ok, t: text }); setTimeout(() => setMsg(null), 4000) }
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (k === 'kind') setConfirmKind(false) }

  function reset() { setEditing(null); setForm(EMPTY); setConfirmKind(false) }

  function startEdit(r) {
    setEditing(r); setMsg(null); setConfirmKind(false)
    setForm({ name_ar: r.name_ar ?? '', name_en: r.name_en ?? '', kind: r.kind ?? 'surgery', base_price: Number(r.base_price) > 0 ? String(r.base_price) : '' })
  }

  // تغيير تصنيف نوع عليه ديلات متممة بيغيّر أرقام الشهور القديمة — لازم تأكيد
  const kindChanged = editing && (editing.kind ?? 'surgery') !== form.kind
  const affected = editing ? usage[editing.id] ?? 0 : 0
  const needsConfirm = kindChanged && affected > 0

  async function save() {
    const name = form.name_ar.trim()
    if (!name) { say(false, t('saleTypes.nameRequired')); return }
    if (rows.some(r => r.name_ar?.trim() === name && r.id !== editing?.id)) { say(false, t('settings.nameTaken')); return }
    const price = form.base_price === '' ? 0 : Number(form.base_price)
    if (!(price >= 0)) { say(false, t('saleTypes.priceNumber')); return }
    if (needsConfirm && !confirmKind) { setConfirmKind(true); return }

    const payload = { name_ar: name, name_en: form.name_en.trim() || null, kind: form.kind, base_price: price }
    setBusy(true)
    const { error } = editing
      ? await supabase.from('procedure_types').update(payload).eq('id', editing.id)
      : await supabase.from('procedure_types').insert({ ...payload, code: `type_${Date.now()}`, is_active: true })
    setBusy(false)
    if (error) { say(false, t('addLead.saveFailed') + ' — ' + dbErr(error.message)); return }
    say(true, editing ? t('dealDrawer.saved') : t('saleTypes.added'))
    reset(); load()
  }

  async function toggle(r) {
    setBusy(true)
    const { error } = await supabase.from('procedure_types').update({ is_active: !r.is_active }).eq('id', r.id)
    setBusy(false)
    if (error) { say(false, t('settings.changeFailed') + ' — ' + dbErr(error.message)); return }
    load()
  }

  const grouped = useMemo(() => KINDS.map(k => ({
    id: k, label: KIND_LABEL(k), list: rows.filter(r => (r.kind ?? 'surgery') === k),
  })), [rows, t])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>{t('settings.tabs.sale_types')}</h2>
          <div className="hint" style={{ marginTop: 4 }}>
            {t('saleTypes.hintTop')}
          </div>
        </div>
        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')} style={{ margin: 12 }}>{msg.t}</div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{t('lead.name')}</th><th>{t('settings.nameEn')}</th><th>{t('saleTypes.basePrice')}</th><th>{t('saleTypes.dealsDone')}</th><th>{t('deals.status')}</th><th></th></tr>
            </thead>
            {grouped.map(g => (
              <tbody key={g.id}>
                <tr>
                  <td colSpan={6} style={{ background: 'var(--line-soft)', fontWeight: 800, fontSize: 13 }}>
                    {g.label} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>({fmtNum(g.list.length)})</span>
                  </td>
                </tr>
                {g.list.length === 0 ? (
                  <tr><td colSpan={6} style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{t('saleTypes.noneHere')}</td></tr>
                ) : g.list.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.45 }}>
                    <td style={{ fontWeight: 600 }}>{r.name_ar}</td>
                    <td dir="ltr" style={{ textAlign: 'start' }}>{r.name_en ?? '—'}</td>
                    <td>{Number(r.base_price) > 0 ? `${fmtNum(r.base_price)} ${t('common.currency')}` : '—'}</td>
                    <td>{fmtNum(usage[r.id] ?? 0)}</td>
                    <td>{r.is_active ? t('settings.enabled') : t('settings.disabled')}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => startEdit(r)}>{t('common.edit')}</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(r)}>
                        {r.is_active ? t('settings.disable') : t('settings.enable')}
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
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editing ? `${t('common.edit')}: ${dn(editing)}` : t('saleTypes.addType')}</h2>

        <div className="field">
          <label>{t('settings.nameAr')}</label>
          <input value={form.name_ar} onChange={e => set('name_ar', e.target.value)}
            placeholder={t('saleTypes.namePh')} onKeyDown={e => e.key === 'Enter' && save()} />
        </div>
        <div className="field">
          <label>{t('settings.nameEn')}</label>
          <input dir="ltr" value={form.name_en} onChange={e => set('name_en', e.target.value)}
            placeholder="e.g. Medicated shampoo" onKeyDown={e => e.key === 'Enter' && save()} />
          <small style={{ color: 'var(--ink-soft)' }}>{t('settings.nameEnHint')}</small>
        </div>

        <div className="field">
          <label>{t('stagesTab.category')}</label>
          <select value={form.kind} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL(k)}</option>)}
          </select>
          <small style={{ color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.6, display: 'block', marginTop: 6 }}>
            {t(`saleTypes.hint.${form.kind}`)}
          </small>
        </div>

        <div className="field">
          <label>{t('saleTypes.basePriceOptional')}</label>
          <input type="number" min={0} value={form.base_price} onChange={e => set('base_price', e.target.value)}
            placeholder={t('saleTypes.basePricePh')} />
        </div>

        {needsConfirm && (
          <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>
            {t('saleTypes.kindChangeWarn', { n: fmtNum(affected), from: KIND_LABEL(editing.kind ?? 'surgery'), to: KIND_LABEL(form.kind) })}
            {confirmKind && <strong> {t('saleTypes.pressAgain')}</strong>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className={'btn ' + (needsConfirm && confirmKind ? 'btn-danger' : 'btn-primary')} onClick={save} disabled={busy}>
            {busy ? '…' : needsConfirm && confirmKind ? t('saleTypes.confirmSave') : editing ? t('common.save') : t('common.add')}
          </button>
          {editing && <button className="btn btn-ghost" onClick={reset} disabled={busy}>{t('common.cancel')}</button>}
        </div>
      </div>
    </div>
  )
}
