// شريط الإجراءات الجماعية — يظهر عند تحديد ليد أو أكثر من الجدول
// الإجراءات: نقل لمرحلة · إسناد لموظف · أرشفة
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { STAGE } from '../lib/stageCodes'

export default function BulkActionsBar({ ids, stages, agents, onDone, onClear }) {
  const [action, setAction] = useState('')      // stage | owner | archive
  const [stageId, setStageId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [coordinatorId, setCoordinatorId] = useState('')
  const [coordinators, setCoordinators] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const count = ids.length
  const targetStage = stages.find(s => s.id === Number(stageId))
  const needsCoordinator = targetStage?.code === STAGE.FOLLOWUP
  const needsLostReason = targetStage?.code === STAGE.LOST

  // جلب المنسقات عند الحاجة فقط
  async function ensureCoordinators() {
    if (coordinators.length) return
    const { data: role } = await supabase.from('roles').select('id').eq('code', 'coordinator').single()
    if (!role) return
    const { data } = await supabase.from('profiles')
      .select('id, full_name').eq('status', 'active').eq('role_id', role.id)
    setCoordinators(data ?? [])
  }

  function pickStage(v) {
    setStageId(v)
    setMsg(null)
    const st = stages.find(s => s.id === Number(v))
    if (st?.code === STAGE.FOLLOWUP) ensureCoordinators()
  }

  async function run() {
    setMsg(null)

    if (action === 'stage') {
      if (!stageId) { setMsg({ ok: false, t: 'اختر المرحلة' }); return }
      if (needsLostReason) {
        setMsg({ ok: false, t: 'النقل الجماعي لمرحلة الخسارة غير متاح — يحتاج سبب لكل عميل' })
        return
      }
      if (needsCoordinator && !coordinatorId) {
        setMsg({ ok: false, t: 'اختر المنسقة المسؤولة قبل التحويل' })
        return
      }
    }
    if (action === 'owner' && !ownerId) { setMsg({ ok: false, t: 'اختر الموظف' }); return }

    const label = action === 'stage'
      ? `نقل ${count} ليد إلى "${targetStage?.name_ar}"`
      : action === 'owner'
        ? `إسناد ${count} ليد إلى ${agents.find(a => a.id === ownerId)?.full_name ?? ''}`
        : `أرشفة ${count} ليد`

    if (!window.confirm(`${label}\n\nهل تريد المتابعة؟`)) return

    setBusy(true)
    try {
      if (action === 'archive') {
        // الأرشفة تتم عبر دالة القاعدة — واحدًا تلو الآخر
        for (const id of ids) {
          const { error } = await supabase.rpc('archive_lead', { p_lead_id: id })
          if (error) throw error
        }
      } else {
        const patch = action === 'stage'
          ? {
              stage_id: Number(stageId),
              ...(needsCoordinator ? { coordinator_id: coordinatorId } : {}),
              stage_entered_at: new Date().toISOString(),
              last_activity: new Date().toISOString(),
            }
          : { owner_id: ownerId, last_activity: new Date().toISOString() }

        const { error } = await supabase.from('leads').update(patch).in('id', ids)
        if (error) throw error
      }

      setBusy(false)
      setMsg({ ok: true, t: `تم — ${label}` })
      setTimeout(() => { setMsg(null); onDone() }, 1200)
    } catch (e) {
      setBusy(false)
      setMsg({
        ok: false,
        t: e.message?.includes('غير مصرح')
          ? 'غير مصرح — إرجاع مرضى من بورد المنسقات يتم عبر المدير فقط'
          : 'تعذر التنفيذ — ' + (e.message || ''),
      })
    }
  }

  return (
    <div className="card bulk-bar">
      <div className="bulk-count">
        <b>{count.toLocaleString('en-US')}</b> ليد محدد
      </div>

      <select value={action} onChange={e => { setAction(e.target.value); setMsg(null) }}
        disabled={busy} style={{ minWidth: 150 }}>
        <option value="">— اختر إجراء —</option>
        <option value="stage">نقل لمرحلة</option>
        <option value="owner">إسناد لموظف</option>
        <option value="archive">أرشفة</option>
      </select>

      {action === 'stage' && (
        <select value={stageId} onChange={e => pickStage(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— المرحلة —</option>
          {stages.map(s => (
            <option key={s.id} value={s.id}>
              {s.name_ar} {(s.board ?? 'sales') === 'coordinator' ? '· منسقات' : ''}
            </option>
          ))}
        </select>
      )}

      {action === 'stage' && needsCoordinator && (
        <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— المنسقة المسؤولة * —</option>
          {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      )}

      {action === 'owner' && (
        <select value={ownerId} onChange={e => setOwnerId(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— الموظف —</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
      )}

      <button className="btn btn-primary" onClick={run} disabled={busy || !action}>
        {busy ? 'جارٍ التنفيذ…' : 'تنفيذ'}
      </button>
      <button className="btn btn-ghost" onClick={onClear} disabled={busy}>
        إلغاء التحديد
      </button>

      {msg && (
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: msg.ok ? 'var(--ok)' : 'var(--danger)',
        }}>
          {msg.t}
        </span>
      )}
    </div>
  )
}
