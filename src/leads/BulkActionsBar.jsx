// شريط الإجراءات الجماعية — يظهر عند تحديد ليد أو أكثر من الجدول
// الإجراءات: نقل لمرحلة · إسناد لموظف · أرشفة
import { useState } from 'react'
import { salesLabel, assignableGroups } from '../lib/people'
import { supabase } from '../lib/supabase'
import { STAGE } from '../lib/stageCodes'
import useT from '../i18n/useT'

export default function BulkActionsBar({ ids, stages, agents, onDone, onClear }) {
  const { t, dn } = useT()
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
      if (!stageId) { setMsg({ ok: false, t: t('bulk.pickStage') }); return }
      if (needsLostReason) {
        setMsg({ ok: false, t: t('bulk.noBulkLost') })
        return
      }
      if (needsCoordinator && !coordinatorId) {
        setMsg({ ok: false, t: t('bulk.pickCoordinator') })
        return
      }
    }
    if (action === 'owner' && !ownerId) { setMsg({ ok: false, t: t('bulk.pickEmployee') }); return }

    const label = action === 'stage'
      ? t('bulk.moveLabel', { n: count, stage: dn(targetStage) })
      : action === 'owner'
        ? t('bulk.assignLabel', { n: count, name: agents.find(a => a.id === ownerId)?.full_name ?? '' })
        : t('bulk.archiveLabel', { n: count })

    if (!window.confirm(`${label}\n\n${t('common.proceedQ')}`)) return

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
      setMsg({ ok: true, t: `${t('common.ok')} — ${label}` })
      setTimeout(() => { setMsg(null); onDone() }, 1200)
    } catch (e) {
      setBusy(false)
      setMsg({
        ok: false,
        t: e.message?.includes('غير مصرح')
          ? t('bulk.notAllowedBack')
          : t('common.failed') + ' — ' + (e.message || ''),
      })
    }
  }

  return (
    <div className="card bulk-bar">
      <div className="bulk-count">
        <b>{count.toLocaleString('en-US')}</b> {t('bulk.selected')}
      </div>

      <select value={action} onChange={e => { setAction(e.target.value); setMsg(null) }}
        disabled={busy} style={{ minWidth: 150 }}>
        <option value="">{t('bulk.pickAction')}</option>
        <option value="stage">{t('bulk.moveToStage')}</option>
        <option value="owner">{t('bulk.assignTo')}</option>
        <option value="archive">{t('bulk.archive')}</option>
      </select>

      {action === 'stage' && (
        <select value={stageId} onChange={e => pickStage(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— {t('lead.stage')} —</option>
          {stages.map(s => (
            <option key={s.id} value={s.id}>
              {dn(s)} {(s.board ?? 'sales') === 'coordinator' ? `· ${t('bulk.coordsTag')}` : ''}
            </option>
          ))}
        </select>
      )}

      {action === 'stage' && needsCoordinator && (
        <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— {t('lead.coordinator')} * —</option>
          {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      )}

      {action === 'owner' && (
        <select value={ownerId} onChange={e => setOwnerId(e.target.value)}
          disabled={busy} style={{ minWidth: 160 }}>
          <option value="">— {t('common.employee')} —</option>
          <optgroup label={t('roles.agent')}>
            {assignableGroups(agents).sales.map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
          </optgroup>
          {assignableGroups(agents).coordinators.length > 0 && (
            <optgroup label={t('roles.coordinator')}>
              {assignableGroups(agents).coordinators.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </optgroup>
          )}
        </select>
      )}

      <button className="btn btn-primary" onClick={run} disabled={busy || !action}>
        {busy ? t('common.working') : t('common.run')}
      </button>
      <button className="btn btn-ghost" onClick={onClear} disabled={busy}>
        {t('bulk.clearSelection')}
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
