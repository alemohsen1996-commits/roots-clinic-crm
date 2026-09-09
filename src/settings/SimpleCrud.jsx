// جدول إدارة بسيط (إضافة/تعديل/تعطيل) — يُستخدم للأطباء والفرق والفروع
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SimpleCrud({ table, nameField, title, placeholder, extraField }) {
  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [extra, setExtra] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [msg, setMsg] = useState(null)     // { ok, t }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select('*').order('id')
    if (error) { setMsg({ ok: false, t: 'تعذر التحميل — ' + error.message }); return }
    setRows(data ?? [])
  }, [table])
  useEffect(() => { load() }, [load])

  const say = (ok, t) => { setMsg({ ok, t }); setTimeout(() => setMsg(null), 3500) }

  function reset() {
    setEditingId(null); setName(''); setExtra('')
  }

  async function save() {
    if (!name.trim()) { say(false, 'اكتب الاسم أولًا'); return }

    const payload = { [nameField]: name.trim() }
    // نرسل الخانة الإضافية دائمًا — حتى الفارغة، وإلا تعذّر مسح قيمة قديمة
    if (extraField) payload[extraField.key] = extra.trim() || null

    setBusy(true)
    const { error } = editingId
      ? await supabase.from(table).update(payload).eq('id', editingId)
      : await supabase.from(table).insert(payload)
    setBusy(false)

    if (error) {
      say(false, error.message?.includes('duplicate')
        ? 'هذا الاسم مسجّل بالفعل'
        : 'تعذر الحفظ — ' + error.message)
      return
    }
    say(true, editingId ? 'تم حفظ التعديل' : 'تمت الإضافة')
    reset(); load()
  }

  async function toggle(r) {
    setBusy(true)
    const { error } = await supabase.from(table)
      .update({ is_active: !r.is_active }).eq('id', r.id)
    setBusy(false)
    if (error) { say(false, 'تعذر التغيير — ' + error.message); return }
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
        {rows.length === 0 ? <div className="empty"><strong>القائمة فارغة</strong></div> : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>الاسم</th>{extraField && <th>{extraField.label}</th>}<th>الحالة</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : .45 }}>
                  <td style={{ fontWeight: 600 }}>{r[nameField]}</td>
                  {extraField && <td>{r[extraField.key] ?? '—'}</td>}
                  <td>{r.is_active ? 'فعال' : 'معطل'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => {
                      setEditingId(r.id)
                      setName(r[nameField] ?? '')
                      setExtra(r[extraField?.key] ?? '')
                      setMsg(null)
                    }}>تعديل</button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => toggle(r)}>
                      {r.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editingId ? 'تعديل' : 'إضافة'}</h2>
        <div className="field">
          <label>الاسم</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={placeholder}
            onKeyDown={e => e.key === 'Enter' && save()} />
        </div>
        {extraField && (
          <div className="field">
            <label>{extraField.label}</label>
            <input value={extra} onChange={e => setExtra(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '…' : editingId ? 'حفظ' : 'إضافة'}
          </button>
          {editingId && (
            <button className="btn btn-ghost" onClick={reset} disabled={busy}>إلغاء</button>
          )}
        </div>
      </div>
    </div>
  )
}
