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

// عداد الإهمال (العلامة الحمراء) — متحكم فيه بالكامل من هنا
//   daily → يعد كل يوم من آخر نشاط · sla → يبدأ بعد مهلة بالساعات · none → من غير عداد
const ALERT_MODES = [
  { v: 'sla',   label: 'يبدأ بعد مهلة' },
  { v: 'daily', label: 'يعد كل يوم من آخر نشاط' },
  { v: 'none',  label: 'من غير عداد' },
]
const FINISHED = ['won', 'lost']   // المراحل المنتهية مفيهاش عداد أصلًا

const alertModeOf = (s) => s.no_alert ? 'none' : (s.sla_hours ? 'sla' : 'daily')

// ملخص العداد في جدول المراحل
function alertSummary(s) {
  if (FINISHED.includes(s.category)) return '—'
  if (s.no_alert) return 'من غير عداد'
  if (s.sla_hours) return `بعد ${s.sla_hours} ساعة`
  return 'يومي'
}

const empty = {
  code: '', name_ar: '', color: '#1a3a5c', category: 'open', board: 'sales',
  alert_mode: 'daily', sla_hours: '', requires_note: false,
}

export default function StagesTab() {
  const [stages, setStages] = useState([])
  const [counts, setCounts] = useState({})
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  // البورد المعروض + السحب والإفلات لترتيب المراحل
  const [boardTab, setBoardTab] = useState('sales')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

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
    const finished = FINISHED.includes(form.category)
    const sla = Number(form.sla_hours)
    if (!finished && form.alert_mode === 'sla' && !(sla > 0)) {
      setErr('اكتب مهلة العداد بالساعات (رقم أكبر من صفر)'); return
    }
    setErr('')
    const payload = {
      name_ar: form.name_ar.trim(),
      color: form.color,
      category: form.category,
      board: form.board,
      // المرحلة المنتهية: من غير عداد ومن غير مهلة
      sla_hours: !finished && form.alert_mode === 'sla' ? sla : null,
      no_alert: !finished && form.alert_mode === 'none',
      requires_note: form.requires_note,
    }
    let error
    if (editing) {
      const current = stages.find(s => s.id === editing)
      // المرحلة الجوهرية: لا نرسل البورد حتى لا يرفض التريجر التعديل كله
      if (current?.is_core) delete payload.board
      ;({ error } = await supabase.from('stages').update(payload).eq('id', editing))
    } else {
      // توحيد الكود: أحرف صغيرة وشُرَط سفلية فقط — الشرطات العادية
      // تكسر الأنماط التي يعتمد عليها النظام (مثل سلسلة no_response_N)
      const code = (form.code.trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
      ) || 'stage_' + Date.now()
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
    setForm({ ...empty, board: boardTab }); setEditing(null); load()
  }

  // المراحل مترتبة جوه كل بورد
  const byBoard = (board) => stages
    .filter(x => (x.board ?? 'sales') === board)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)

  // حفظ الترتيب: بورد المبيعات الأول وبعده المنسقات، بأرقام متتالية 1..N
  // (بيصلّح كمان أي أرقام مكررة قديمة) — وبنحدّث بس المراحل اللي رقمها اتغيّر
  async function saveOrder(board, ids) {
    const sales = board === 'sales' ? ids : byBoard('sales').map(x => x.id)
    const coord = board === 'coordinator' ? ids : byBoard('coordinator').map(x => x.id)
    const next = Object.fromEntries([...sales, ...coord].map((id, i) => [id, i + 1]))
    // تحديث فوري على الشاشة، والحفظ في الخلفية
    setStages(list => list.map(x => next[x.id] ? { ...x, sort_order: next[x.id] } : x))
    const changed = stages.filter(x => next[x.id] && next[x.id] !== x.sort_order)
    const results = await Promise.all(changed.map(x =>
      supabase.from('stages').update({ sort_order: next[x.id] }).eq('id', x.id)))
    const failed = results.find(r => r.error)
    if (failed) setErr('تعذر حفظ الترتيب — ' + failed.error.message)
    else say('تم حفظ الترتيب')
    load()
  }

  function move(s, dir) {
    const ids = byBoard(s.board ?? 'sales').map(x => x.id)
    const i = ids.indexOf(s.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    saveOrder(s.board ?? 'sales', ids)
  }

  function dropOn(targetId) {
    const from = dragId
    setDragId(null); setOverId(null)
    if (from == null || from === targetId) return
    const ids = byBoard(boardTab).map(x => x.id)
    const fi = ids.indexOf(from), ti = ids.indexOf(targetId)
    if (fi < 0 || ti < 0) return
    ids.splice(ti, 0, ids.splice(fi, 1)[0])
    saveOrder(boardTab, ids)
  }

  async function toggleActive(s) {
    setErr('')
    const n = counts[s.id] ?? 0
    // التعطيل يُخفي ليدات المرحلة من كل الشاشات — تحذير صريح
    if (s.is_active && n > 0) {
      const go = window.confirm(
        `هذه المرحلة تحتوي ${n.toLocaleString('en-US')} ليد.\n\n` +
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
      alert_mode: alertModeOf(s), sla_hours: s.sla_hours ?? '',
      requires_note: s.requires_note,
    })
  }

  const editingStage = stages.find(s => s.id === editing)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        {ok && <div className="alert alert-ok" style={{ margin: 12 }}>{ok}</div>}
        <div className="tabs" style={{ margin: '12px 16px 0' }}>
          {BOARDS.map(b => (
            <button key={b.v} type="button"
              className={'tab' + (boardTab === b.v ? ' on' : '')}
              onClick={() => { setBoardTab(b.v); if (!editing) set('board', b.v) }}>
              {b.label} ({byBoard(b.v).length.toLocaleString('en-US')})
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '0 16px', margin: '-8px 0 6px' }}>
          اسحب المرحلة من ⋮⋮ وحطها في المكان اللي عاوزه — الترتيب هنا هو ترتيب أعمدة البورد
        </p>
        <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>الترتيب</th><th>المرحلة</th>
              <th>التصنيف</th><th>عداد الإهمال</th><th>الليدات</th><th>الحالة</th><th></th>
            </tr>
          </thead>
          <tbody>
            {byBoard(boardTab).map((s, idx, list) => (
              <tr key={s.id}
                draggable
                onDragStart={e => { setDragId(s.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => { e.preventDefault(); if (overId !== s.id) setOverId(s.id) }}
                onDragLeave={() => setOverId(o => (o === s.id ? null : o))}
                onDrop={e => { e.preventDefault(); dropOn(s.id) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                className={'stage-row' + (dragId === s.id ? ' dragging' : '')
                  + (overId === s.id && dragId !== s.id ? ' over' : '')}
                style={{ opacity: dragId === s.id ? .4 : (s.is_active ? 1 : .45) }}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="drag-handle" title="اسحب لإعادة الترتيب" style={{ cursor: 'grab', marginInlineEnd: 6 }}>⋮⋮</span>
                  {/* الأسهم للموبايل — السحب مش شغال باللمس */}
                  <button className="btn btn-ghost" style={{ padding: '2px 8px' }} disabled={idx === 0}
                    onClick={() => move(s, -1)} aria-label="لفوق">↑</button>
                  <button className="btn btn-ghost" style={{ padding: '2px 8px' }} disabled={idx === list.length - 1}
                    onClick={() => move(s, 1)} aria-label="لتحت">↓</button>
                </td>
                <td>
                  <span className="badge stage-pill" style={{ '--stage': s.color }}>
                    ● {s.name_ar}
                  </span>
                  {s.is_core && (
                    <span title="مرحلة جوهرية — النظام يعتمد على كودها"
                      style={{ marginInlineStart: 6, fontSize: 12 }}>🔒</span>
                  )}
                </td>
                <td style={{ fontSize: 12.5 }}>{CATEGORIES.find(c => c.v === s.category)?.label}</td>
                <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{alertSummary(s)}</td>
                <td style={{ fontWeight: 600 }}>{(counts[s.id] ?? 0).toLocaleString('en-US')}</td>
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
        </div>
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
            🔒 مرحلة جوهرية — يمكن تغيير الاسم واللون والتصنيف وعداد الإهمال فقط
          </div>
        )}

        <div className="field">
          <label>الاسم</label>
          <input value={form.name_ar} onChange={e => set('name_ar', e.target.value)} placeholder="مثال: لا يرد 4" />
        </div>
        {!editing && (
          <div className="field">
            <label>الكود (إنجليزي، اختياري)</label>
            <input dir="ltr" value={form.code} onChange={e => set('code', e.target.value)}
              placeholder="no_response_5" />
            <small style={{ color: 'var(--ink-soft)' }}>
              يُحوَّل تلقائيًا لأحرف صغيرة وشُرَط سفلية.
              لإضافة مرحلة لسلسلة «لا يرد» استخدم <b>no_response_5</b> وهكذا
            </small>
          </div>
        )}
        <div className="field">
          <label>البورد</label>
          <select value={form.board} onChange={e => set('board', e.target.value)}
            disabled={!!editingStage?.is_core}>
            {BOARDS.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>اللون</label>
          <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ height: 42, padding: 4 }} />
        </div>
        <div className="field">
          <label>التصنيف</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>

        {/* عداد الإهمال — العلامة الحمراء على الكارت */}
        <div className="field">
          <label>عداد الإهمال (العلامة الحمراء)</label>
          {FINISHED.includes(form.category) ? (
            <small style={{ color: 'var(--ink-soft)', lineHeight: 1.7 }}>
              مرحلة منتهية (نجاح أو خسارة) — مفيش عداد إهمال فيها
            </small>
          ) : (
            <>
              <select value={form.alert_mode} onChange={e => set('alert_mode', e.target.value)}>
                {ALERT_MODES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
              {form.alert_mode === 'sla' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input type="number" min={1} value={form.sla_hours}
                    onChange={e => set('sla_hours', e.target.value)} placeholder="48" style={{ width: 100 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>ساعة من آخر نشاط</span>
                </div>
              )}
              <small style={{ color: 'var(--ink-soft)', lineHeight: 1.7, marginTop: 6 }}>
                {form.alert_mode === 'sla' && (form.sla_hours
                  ? `مفيش علامة أول ${form.sla_hours} ساعة، وبعدها بتظهر 1 وتزيد 1 كل 24 ساعة`
                  : 'اكتب المهلة بالساعات')}
                {form.alert_mode === 'daily' && 'العلامة بتظهر بعد يوم من آخر نشاط، وتزيد 1 كل يوم'}
                {form.alert_mode === 'none' && 'الليدات في المرحلة دي مش هيظهر عليها عداد إهمال خالص'}
                {' — '}ولو الليد عليه مهمة، العداد بيمشي على ميعاد المهمة
              </small>
            </>
          )}
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
            <button className="btn btn-ghost" onClick={() => { setEditing(null); setForm({ ...empty, board: boardTab }); setErr('') }}>إلغاء</button>
          )}
        </div>
      </div>
    </div>
  )
}
