// قوالب واتساب — المدير يكتب الرسايل الجاهزة اللي السيلز بيستخدمها من ملف الليد
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dbErr } from '../lib/dbErrors'
import useT from '../i18n/useT'
import { invalidateWaTemplates } from '../chat/WaTemplatesMenu'

const EMPTY = { title: '', body: '', sort_order: 0 }

export default function WaTemplatesTab() {
  const { t } = useT()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wa_templates').select('*').order('sort_order').order('id')
    if (error) { setMsg({ ok: false, t: t('settings.loadFailed') + ' — ' + dbErr(error.message) }); return }
    setRows(data ?? [])
  }, [t])
  useEffect(() => { load() }, [load])

  const say = (ok, text) => { setMsg({ ok, t: text }); setTimeout(() => setMsg(null), 3500) }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const reset = () => { setEditing(null); setForm(EMPTY) }

  async function save() {
    if (!form.title.trim()) { say(false, t('settings.nameRequired')); return }
    if (!form.body.trim()) { say(false, t('waTpl.bodyRequired')); return }
    const payload = { title: form.title.trim(), body: form.body.trim(), sort_order: Number(form.sort_order) || 0 }
    setBusy(true)
    const { error } = editing
      ? await supabase.from('wa_templates').update(payload).eq('id', editing)
      : await supabase.from('wa_templates').insert(payload)
    setBusy(false)
    if (error) { say(false, t('addLead.saveFailed') + ' — ' + dbErr(error.message)); return }
    say(true, editing ? t('dealDrawer.saved') : t('settings.added'))
    invalidateWaTemplates(); reset(); load()
  }
  async function toggle(r) {
    setBusy(true)
    const { error } = await supabase.from('wa_templates').update({ is_active: !r.is_active }).eq('id', r.id)
    setBusy(false)
    if (error) { say(false, t('settings.changeFailed') + ' — ' + dbErr(error.message)); return }
    invalidateWaTemplates(); load()
  }
  async function remove(r) {
    if (!confirm(t('waTpl.deleteQ', { title: r.title }))) return
    setBusy(true)
    const { error } = await supabase.from('wa_templates').delete().eq('id', r.id)
    setBusy(false)
    if (error) { say(false, t('general.deleteFailed') + ' — ' + dbErr(error.message)); return }
    invalidateWaTemplates(); load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>{t('waTpl.title')}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{t('waTpl.hint', { name: '{{name}}' })}</p>
        </div>
        {msg && <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')} style={{ margin: 12 }}>{msg.t}</div>}
        {rows.length === 0 ? <div className="empty"><strong>{t('settings.emptyList')}</strong></div> : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead><tr><th>#</th><th>{t('waTpl.name')}</th><th>{t('waTpl.body')}</th><th>{t('deals.status')}</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : .45 }}>
                  <td>{r.sort_order}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.title}</td>
                  <td style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', maxWidth: 420 }}>{r.body}</td>
                  <td>{r.is_active ? t('settings.enabled') : t('settings.disabled')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => { setEditing(r.id); setForm({ title: r.title, body: r.body, sort_order: r.sort_order }) }}>{t('common.edit')}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(r)}>
                      {r.is_active ? t('settings.disable') : t('settings.enable')}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} style={{ color: 'var(--danger)' }} onClick={() => remove(r)}>{t('common.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editing ? t('common.edit') : t('waTpl.add')}</h2>
        <div className="field">
          <label>{t('waTpl.name')}</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('waTpl.body')}</label>
          <textarea rows={6} value={form.body} onChange={e => set('body', e.target.value)} />
          <small style={{ color: 'var(--ink-soft)' }}>{t('waTpl.nameVar', { name: '{{name}}' })}</small>
        </div>
        <div className="field">
          <label>{t('stagesTab.order')}</label>
          <input type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} style={{ width: 100 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : editing ? t('common.save') : t('common.add')}</button>
          {editing && <button className="btn btn-ghost" onClick={reset} disabled={busy}>{t('common.cancel')}</button>}
        </div>
      </div>
    </div>
  )
}
