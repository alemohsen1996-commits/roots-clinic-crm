// إدارة المراحل — إضافة/تعديل/ترتيب/تعطيل + تحديد البورد (مبيعات/منسقة)
// المراحل الجوهرية محمية: لا تُعطَّل ولا يتغيّر كودها (النظام يعتمد عليها نصًّا)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CATEGORIES = [
  { v: 'open',    label: 'مفتوحة (ضمن الدورة)' },
  { v: 'won',     label: 'نجاح (Done)' },
  { v: 'lost',    label: 'خسارة' },
  { v: 'waiting', label: 'انتظار' },
]

const BOARDS = [
  { v: 'sales',       label: 'بورد المبيعات' },
  { v: 'coordinator', label: 'بورد المنسقات' },
]

const empty = { code: '', name_ar: '', color: '#1a3a5c', category: 'open', board: 'sales', sla_hours: '', requires_note: false }

export default function StagesTab() {
  const [stages, setStages] = useState([])
  const [counts, setCounts] = useState({})
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    const [{ data }, { data: c }] = await Promise.all([
      supabase.from('stages').select('*').order('sort_order'),
      supabase.rpc('stage_lead_counts'),
    ])
    setStages(data ?? [])
    setCounts(Object.fromEntries((c ?? []).map(r => [r.stage_id, r.leads_count])))
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const say = (m) => { setOk(m); setTimeout(() => setOk(''), 3000) }

  async function save() {
    if (!form.name_ar.trim()) { setErr('اكتب اسم المرحلة'); return }
    setErr('')
    const payload = {
      name_ar: form.name_ar.trim(),
      color: form.color,
      category: form.category,
      board: form.board,
      sla_hours: form.sla_hours ? Number(form.sla_hours) : null,
      requires_note: form.requires_note,
    }
    let error
    if (editing) {
      const current = stages.find(s => s.id === editing)
      // المرحلة الجوهرية: لا نرسل البورد حتى لا يرفض التريجر التعديل كله
      if (current?.is_core) delete payload.board
      ;({ error } = await supabase.from('stages').update(payload).eq('id', editing))
    } else {
      const code = form.code.trim() || 'stage_' + Date.now()
      if (stages.some(s => s.code === code)) {
        setErr('هذا الكود مستخدم بالفعل — اختر كودًا آخر')
        return
      }
      const maxOrder = Math.max(0, ...stages.map(s => s.sort_order))
      ;({ error } = await supabase.from('stages').insert({ ...payload, code, sort_order: maxOrder + 1 }))
    }
    if (error) {
      setErr(error.message?.includes('جوهرية') ? error.message : 'تعذر الحفظ — ' + error.message)
      return
    }
    say(editing ? 'تم حفظ التعديل' : 'تمت إضافة المرحلة')
    setForm(empty); setEditing(null); load()
  }

  async function move(s, dir) {
    const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order)
    const i = sorted.findIndex(x => x.id === s.id)
    const j = i + dir
    if (j < 0 || j >= sorted.length) return
    const other = sorted[j]
    await Promise.all([
      supabase.from('stages').update({ sort_order: other.sort_order }).eq('id', s.id),
      supabase.from('stages').update({ sort_order: s.sort_order }).eq('id', other.id),
    ])
    load()
  }

  async function toggleActive(s) {
    setErr('')
    const n = counts[s.id] ?? 0
    // التعطيل يُخفي ليدات المرحلة من كل الشاشات — تحذير صريح
    if (s.is_active && n > 0) {
      const go = window.confirm(
        `هذه المرحلة تحتوي ${n.toLocaleString('ar-EG')} ليد.\n\n` +
        `تعطيلها سيُخفيهم من البورد والجدول تمامًا (لن يُحذفوا، لكن لن يراهم أحد).\n\n` +
        `الأفضل نقلهم لمرحلة أخرى أولًا. هل تريد المتابعة رغم ذلك؟`
      )
      if (!go) return
    }
    const { error } = await supabase.from('stages')
      .update({ is_active: !s.is_active }).eq('id', s.id)
    if (error) { setErr(error.message || 'تعذر التغيير'); return }
    load()
  }

  function startEdit(s) {
    setErr('')
    setEditing(s.id)
    setForm({
      code: s.code, name_ar: s.name_ar, color: s.color,
      category: s.category, board: s.board ?? 'sales',
      sla_hours: s.sla_hours ?? '', requires_note: s.requires_note,
    })
  }

  const editingStage = stages.find(s => s.id === editing)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        {ok && <div className="alert alert-ok" style={{ margin: 12 }}>{ok}</div>}
        <table className="table">
          <thead>
            <tr>
              <th>الترتيب</th><th>المرحلة</th><th>البورد</th>
              <th>التصنيف</th><th>الليدات</th><th>الحالة</th><th></th>
            </tr>
          </thead>
          <tbody>
            {stages.map(s => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : .45 }}>
                <td>
                  <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={() => move(s, -1)}>↑</button>
                  <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={() => move(s, 1)}>↓</button>
                </td>
                <td>
                  <span className="badge" style={{ background: s.color + '22', color: s.color }}>
                    ● {s.name_ar}
                  </span>
                  {s.is_core && (
                    <span title="مرحلة جوهرية — النظام يعتمد على كودها"
                      style={{ marginInlineStart: 6, fontSize: 12 }}>🔒</span>
                  )}
                </td>
                <td style={{ fontSize: 12.5 }}>{s.board === 'coordinator' ? 'المنسقات' : 'المبيعات'}</td>
                <td style={{ fontSize: 12.5 }}>{CATEGORIES.find(c => c.v === s.category)?.label}</td>
                <td style={{ fontWeight: 600 }}>{(counts[s.id] ?? 0).toLocaleString('ar-EG')}</td>
                <td>{s.is_active ? 'فعالة' : 'معطلة'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" onClick={() => startEdit(s)}>تعديل</button>
                  {s.is_core ? (
                    <span style={{ fontSize: 12, color: 'var(--ink-soft)', alignSelf: 'center' }}>محمية</span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => toggleActive(s)}>
                      {s.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '0 16px 16px', lineHeight: 1.7 }}>
          🔒 المراحل المحمية يعتمد عليها النظام بالاسم البرمجي (سلسلة لا يرد، التحويل
          للمنسقة، فتح ملف التعاقد…) — يمكن تعديل اسمها ولونها فقط.
        </p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{editing ? 'تعديل مرحلة' : 'مرحلة جديدة'}</h2>
        {err && <div className="alert alert-error">{err}</div>}
        {editingStage?.is_core && (
          <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            🔒 مرحلة جوهرية — يمكن تغيير الاسم واللون والتصنيف فقط
          </div>
        )}

        <div className="field">
          <label>الاسم</label>
          <input value={form.name_ar} onChange={e => set('name_ar', e.target.value)} placeholder="مثال: لا يرد 4" />
        </div>
        {!editing && (
          <div className="field">
            <label>الكود (إنجليزي، اختياري)</label>
            <input dir="ltr" value={form.code} onChange={e => set('code', e.target.value)} placeholder="no_response_4" />
          </div>
        )}
        <div className="field">
          <label>البورد</label>
          <select value={form.board} onChange={e => set('board', e.target.value)}
            disabled={!!editingStage?.is_core}>
            {BOARDS.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>اللون</label>
            <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ height: 42, padding: 4 }} />
          </div>
          <div className="field">
            <label>مهلة SLA (ساعات)</label>
            <input type="number" min={0} value={form.sla_hours} onChange={e => set('sla_hours', e.target.value)} placeholder="بدون" />
          </div>
        </div>
        <div className="field">
          <label>التصنيف</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="rn" checked={form.requires_note}
            onChange={e => set('requires_note', e.target.checked)} style={{ width: 17, height: 17 }} />
          <label htmlFor="rn" style={{ marginBottom: 0 }}>إجبار كتابة ملاحظة عند الدخول لها</label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save}>
            {editing ? 'حفظ التعديل' : 'إضافة المرحلة'}
          </button>
          {editing && (
            <button className="btn btn-ghost" onClick={() => { setEditing(null); setForm(empty); setErr('') }}>إلغاء</button>
          )}
        </div>
      </div>
    </div>
  )
}
