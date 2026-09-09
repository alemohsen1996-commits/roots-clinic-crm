// نقل الليدات الجماعي بين الموظفين
// ينقل الليدات النشطة فقط، مع خيار تغيير مرحلتها كلها
// الديلات والعمولات القديمة تبقى باسم الموظف القديم (لا تتأثر)
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function BulkReassignModal({ people, onClose, onDone }) {
  const [fromUser, setFromUser] = useState('')
  const [toUser, setToUser] = useState('')
  const [fromStage, setFromStage] = useState('')   // '' = كل المراحل النشطة
  const [toStage, setToStage] = useState('')       // '' = اترك كما هي
  const [stages, setStages] = useState([])
  const [count, setCount] = useState(null)         // معاينة عدد الليدات
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  // المراحل النشطة فقط (open) — لأن النقل يقتصر عليها
  useEffect(() => {
    supabase.from('stages')
      .select('id, name_ar, category')
      .eq('is_active', true)
      .eq('category', 'open')
      .order('sort_order')
      .then(({ data }) => setStages(data ?? []))
  }, [])

  // معاينة عدد الليدات القابلة للنقل كلما تغيّر المصدر أو المرحلة
  useEffect(() => {
    if (!fromUser) { setCount(null); return }
    supabase.rpc('count_reassignable_leads', {
      p_from_user: fromUser,
      p_from_stage: fromStage ? Number(fromStage) : null,
    }).then(({ data }) => setCount(data ?? 0))
  }, [fromUser, fromStage])

  const activePeople = people.filter(p => p.status !== 'pending')
  const toOptions = useMemo(
    () => activePeople.filter(p => p.id !== fromUser && p.status === 'active'),
    [activePeople, fromUser]
  )

  async function run() {
    if (!fromUser || !toUser) { setErr('اختر الموظف المصدر والوجهة'); return }
    if (fromUser === toUser) { setErr('لا يمكن النقل لنفس الموظف'); return }
    if (!count) { setErr('لا توجد ليدات نشطة للنقل بهذا الفلتر'); return }
    setErr(''); setBusy(true)

    const { data, error } = await supabase.rpc('bulk_reassign_leads', {
      p_from_user: fromUser,
      p_to_user: toUser,
      p_from_stage: fromStage ? Number(fromStage) : null,
      p_to_stage: toStage ? Number(toStage) : null,
    })

    setBusy(false)
    if (error) { setErr('تعذر النقل — تأكد من صلاحيتك'); return }
    setDone(data)
  }

  const fromName = activePeople.find(p => p.id === fromUser)?.full_name
  const toName = activePeople.find(p => p.id === toUser)?.full_name

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        {done !== null ? (
          <>
            <h2>تم النقل بنجاح</h2>
            <div className="alert alert-ok" style={{ marginTop: 14 }}>
              تم نقل {done} ليد من {fromName} إلى {toName}.
              الديلات والعمولات القديمة بقيت كما هي باسم الموظف السابق.
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onDone}>تمام</button>
            </div>
          </>
        ) : (
          <>
            <h2>نقل الليدات بين الموظفين</h2>
            <p className="sub">ينقل الليدات النشطة فقط — الخاسرة والمكتملة تبقى كما هي</p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="grid-2">
              <div className="field">
                <label>من الموظف</label>
                <select value={fromUser} onChange={e => { setFromUser(e.target.value); setToUser('') }}>
                  <option value="">— اختر —</option>
                  {activePeople.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>إلى الموظف</label>
                <select value={toUser} onChange={e => setToUser(e.target.value)} disabled={!fromUser}>
                  <option value="">— اختر —</option>
                  {toOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>الليدات في مرحلة</label>
              <select value={fromStage} onChange={e => setFromStage(e.target.value)}>
                <option value="">كل المراحل النشطة</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
              </select>
            </div>

            <div className="field">
              <label>حوّلهم لمرحلة (اختياري)</label>
              <select value={toStage} onChange={e => setToStage(e.target.value)}>
                <option value="">اترك مرحلتهم كما هي</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
              </select>
            </div>

            {fromUser && (
              <div className="alert" style={{
                background: count ? 'var(--primary-soft)' : 'var(--warn-soft)',
                color: count ? 'var(--primary)' : 'var(--warn)',
              }}>
                {count === null ? 'جارٍ الحساب…'
                  : count === 0 ? 'لا توجد ليدات نشطة مطابقة لهذا الفلتر'
                  : `سيتم نقل ${count} ليد نشط`}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={run} disabled={busy || !count}>
                {busy ? 'جارٍ النقل…' : 'تنفيذ النقل'}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
