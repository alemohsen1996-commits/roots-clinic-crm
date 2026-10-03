// جدول إدارة بسيط (إضافة/تعديل/تعطيل) — يُستخدم للأطباء والفرق والفروع
// nameEnField: عمود الاسم الإنجليزي (اختياري) — الواجهة الإنجليزية بتعرضه لو موجود
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import useT from '../i18n/useT'

export default function SimpleCrud({ table, nameField, nameEnField, title, placeholder, extraField }) {
  const { t } = useT()
  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [extra, setExtra] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [msg, setMsg] = useState(null)     // { ok, t }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select('*').order('id')
    if (error) { setMsg({ ok: false, t: t('settings.loadFailed') + ' — ' + error.message }); return }
    setRows(data ?? [])
  }, [table])
  useEffect(() => { load() }, [load])

  const say = (ok, text) => { setMsg({ ok, t: text }); setTimeout(() => setMsg(null), 3500) }

  function reset() {
    setEditingId(null); setName(''); setNameEn(''); setExtra('')
  }

  async function save() {
    if (!name.trim()) { say(false, t('settings.nameRequired')); return }

    const payload = { [nameField]: name.trim() }
    if (nameEnField) payload[nameEnField] = nameEn.trim() || null
    // نرسل الخانة الإضافية دائمًا — حتى الفارغة، وإلا تعذّر مسح قيمة قديمة
    if (extraField) payload[extraField.key] = extra.trim() || null

    setBusy(true)
    const { error } = editingId
      ? await supabase.from(table).update(payload).eq('id', editingId)
      : await supabase.from(table).insert(payload)
    setBusy(false)

    if (error) {
      say(false, error.message?.includes('duplicate')
        ? t('settings.nameTaken')
        : t('addLead.saveFailed') + ' — ' + error.message)
      return
    }
    say(true, editingId ? t('dealDrawer.saved') : t('settings.added'))
    reset(); load()
  }

  async function toggle(r) {
    setBusy(true)
    const { error } = await supabase.from(table)
      .update({ is_active: !r.is_active }).eq('id', r.id)
    setBusy(false)
    if (error) { say(false, t('settings.changeFailed') + ' — ' + error.message); return }
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ padding: '16px 16px 0' }}><h2 style={{ fontSize: 15 }}>{title}</h2></div>
        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')} style={{ margin: 12 }}>
            {msg.t}
          </div>
        )}
        {rows.length === 0 ? <div className="empty"><strong>{t('settings.emptyList')}</strong></div> : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{t('lead.name')}</th>{nameEnField && <th>{t('settings.nameEn')}</th>}{extraField && <th>{extraField.label}</th>}<th>{t('deals.status')}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : .45 }}>
                  <td style={{ fontWeight: 600 }}>{r[nameField]}</td>
                  {nameEnField && <td dir="ltr" style={{ textAlign: 'start' }}>{r[nameEnField] ?? '—'}</td>}
                  {extraField && <td>{r[extraField.key] ?? '—'}</td>}
                  <td>{r.is_active ? t('settings.enabled') : t('settings.disabled')}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => {
                      setEditingId(r.id)
                      setName(r[nameField] ?? '')
                      setNameEn(nameEnField ? (r[nameEnField] ?? '') : '')
                      setExtra(r[extraField?.key] ?? '')
                      setMsg(null)
                    }}>{t('common.edit')}</button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => toggle(r)}>
                      {r.is_active ? t('settings.disable') : t('settings.enable')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editingId ? t('common.edit') : t('common.add')}</h2>
        <div className="field">
          <label>{nameEnField ? t('settings.nameAr') : t('lead.name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={placeholder}
            onKeyDown={e => e.key === 'Enter' && save()} />
        </div>
        {nameEnField && (
          <div className="field">
            <label>{t('settings.nameEn')}</label>
            <input dir="ltr" value={nameEn} onChange={e => setNameEn(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()} />
            <small style={{ color: 'var(--ink-soft)' }}>{t('settings.nameEnHint')}</small>
          </div>
        )}
        {extraField && (
          <div className="field">
            <label>{extraField.label}</label>
            <input value={extra} onChange={e => setExtra(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '…' : editingId ? t('common.save') : t('common.add')}
          </button>
          {editingId && (
            <button className="btn btn-ghost" onClick={reset} disabled={busy}>{t('common.cancel')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
