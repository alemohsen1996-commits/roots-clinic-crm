// نقل الليدات الجماعي بين الموظفين
// ينقل الليدات النشطة فقط، مع خيار تغيير مرحلتها كلها
// الديلات والعمولات القديمة تبقى باسم الموظف القديم (لا تتأثر)
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import useT from '../i18n/useT'

export default function BulkReassignModal({ people, onClose, onDone }) {
  const { t, dn } = useT()
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
      .select('id, name_ar, name_en, category')
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
    if (!fromUser || !toUser) { setErr(t('reassign.pickBoth')); return }
    if (fromUser === toUser) { setErr(t('reassign.sameUser')); return }
    if (!count) { setErr(t('reassign.noLeads')); return }
    setErr(''); setBusy(true)

    const { data, error } = await supabase.rpc('bulk_reassign_leads', {
      p_from_user: fromUser,
      p_to_user: toUser,
      p_from_stage: fromStage ? Number(fromStage) : null,
      p_to_stage: toStage ? Number(toStage) : null,
    })

    setBusy(false)
    if (error) { setErr(t('reassign.failed')); return }
    setDone(data)
  }

  const fromName = activePeople.find(p => p.id === fromUser)?.full_name
  const toName = activePeople.find(p => p.id === toUser)?.full_name

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        {done !== null ? (
          <>
            <h2>{t('reassign.doneTitle')}</h2>
            <div className="alert alert-ok" style={{ marginTop: 14 }}>
              {t('reassign.doneBody', { n: done, from: fromName, to: toName })}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onDone}>{t('common.ok')}</button>
            </div>
          </>
        ) : (
          <>
            <h2>{t('reassign.title')}</h2>
            <p className="sub">{t('reassign.sub')}</p>

            {err && <div className="alert alert-error">{err}</div>}

            <div className="grid-2">
              <div className="field">
                <label>{t('reassign.fromUser')}</label>
                <select value={fromUser} onChange={e => { setFromUser(e.target.value); setToUser('') }}>
                  <option value="">{t('common.pick')}</option>
                  {activePeople.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('reassign.toUser')}</label>
                <select value={toUser} onChange={e => setToUser(e.target.value)} disabled={!fromUser}>
                  <option value="">{t('common.pick')}</option>
                  {toOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>{t('reassign.leadsInStage')}</label>
              <select value={fromStage} onChange={e => setFromStage(e.target.value)}>
                <option value="">{t('reassign.allActiveStages')}</option>
                {stages.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
              </select>
            </div>

            <div className="field">
              <label>{t('reassign.moveToStage')}</label>
              <select value={toStage} onChange={e => setToStage(e.target.value)}>
                <option value="">{t('reassign.keepStage')}</option>
                {stages.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
              </select>
            </div>

            {fromUser && (
              <div className="alert" style={{
                background: count ? 'var(--primary-soft)' : 'var(--warn-soft)',
                color: count ? 'var(--primary)' : 'var(--warn)',
              }}>
                {count === null ? t('reassign.counting')
                  : count === 0 ? t('reassign.noMatch')
                  : t('reassign.willMove', { n: count })}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={run} disabled={busy || !count}>
                {busy ? t('reassign.moving') : t('reassign.run')}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
