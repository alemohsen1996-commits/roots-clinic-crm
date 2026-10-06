// اللوحة الجانبية للديل
// الملخص المالي (من v_deal_finance) + تحديد النتيجة + تعديل المنسقة + القفل المحاسبي
import { useCallback, useEffect, useState } from 'react'
import { salesLabel } from '../lib/people'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchDealFinance, DEAL_STATUS, PAY_STATUS, kindOf, dateLabel } from './useDealRefs'
import ProcedureOptions from './ProcedureOptions'
import DealPaymentsModal from './DealPaymentsModal'
import { fmtNum, fmtDate } from '../lib/format'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

export default function DealDrawer({ dealId, refs, siblings, onNavigate, onClose, onChanged }) {
  const { isManager, isSuperAdmin, roleCode, profile } = useAuth()
  const { t, dn, isRtl, isEn } = useT()
  const SAR = t('common.currency')
  const [deal, setDeal] = useState(null)
  const [fin, setFin] = useState(null)
  const [err, setErr] = useState('')
  const [confirmOutcome, setConfirmOutcome] = useState(null)  // done | lost | waiting
  // تاريخ العملية الفعلي عند "تمت العملية" — الإيراد والعمولة بيتحسبوا على شهره
  const [doneDate, setDoneDate] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const [showPays, setShowPays] = useState(false)   // تفاصيل المحصّل + صور الإيصالات

  const load = useCallback(async () => {
    const [{ data: d }, f] = await Promise.all([
      supabase.from('deals')
        .select(`*, leads(file_no, full_name, phone, branches(name, name_en)),
                 agent:profiles!deals_agent_id_fkey(full_name),
                 coordinator:profiles!deals_coordinator_id_fkey(full_name),
                 procedure_types(name_ar, name_en, kind), techniques(name, name_ar), doctors(full_name)`)
        .eq('id', dealId).single(),
      fetchDealFinance(dealId),
    ])
    setDeal(d)
    setFin(f)
    setForm({
      procedure_type_id: d?.procedure_type_id ?? '',
      technique_id: d?.technique_id ?? '',
      doctor_id: d?.doctor_id ?? '',
      grafts: d?.grafts ?? '',
      operation_date: d?.operation_date ?? '',
      total_amount: d?.total_amount ?? '',
      tax_amount: d?.tax_amount ?? 0,
      tax_note: d?.tax_note ?? '',
    })
  }, [dealId])

  useEffect(() => { load() }, [load])

  // عند التنقّل لديل تاني: نقفل أي تعديل أو تأكيد مفتوح من الديل السابق
  useEffect(() => {
    setEditing(false); setConfirmOutcome(null); setErr(''); setFlash('')
  }, [dealId])

  // التنقّل بين الديلات المعروضة في الصفحة الحالية — يحترم الفلاتر
  const navList = Array.isArray(siblings) ? siblings : []
  const navIndex = navList.findIndex(x => Number(x.id) === Number(dealId))
  const hasNav = navList.length > 1 && navIndex !== -1
  const prevDeal = hasNav && navIndex > 0 ? navList[navIndex - 1] : null
  const nextDeal = hasNav && navIndex < navList.length - 1 ? navList[navIndex + 1] : null
  const goTo = (d) => { if (d && onNavigate) onNavigate(d) }

  // ← و → للتنقّل، Esc للإغلاق — ما لم يكن المؤشر داخل حقل إدخال
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target?.tagName
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return
      if (showPays) return          // نافذة الإيصالات مفتوحة: Esc يقفلها هي بس
      if (e.key === 'Escape') { onClose(); return }
      if (!hasNav || editing) return
      // في الواجهة العربية: السهم الأيسر يتقدّم للتالي
      if (e.key === 'ArrowLeft')  goTo(nextDeal)
      if (e.key === 'ArrowRight') goTo(prevDeal)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function setOutcome(status) {
    setErr('')
    const patch = { status }
    if (status === 'done') {
      if (!doneDate) { setErr(t('dealDrawer.err.setDate')); return }
      if (doneDate > todayRiyadh()) { setErr(t('dealDrawer.err.futureDate')); return }
      patch.operation_date = doneDate
    }
    const { error } = await supabase.from('deals').update(patch).eq('id', dealId)
    if (error) {
      setErr(error.message?.includes('غير مصرح')
        ? t('dealDrawer.err.outcomeRoles')
        : error.message?.includes('المستقبل')
          ? t('dealDrawer.err.doneFuture')
          : t('dealDrawer.err.statusFailed'))
      return
    }
    setConfirmOutcome(null)
    await load()
    onChanged()
  }

  async function saveEdit() {
    setErr('')
    if (deal.status === 'done') {
      if (!form.operation_date) { setErr(t('dealDrawer.err.doneNeedsDate')); return }
      if (form.operation_date > todayRiyadh()) { setErr(t('dealDrawer.err.futureDate')); return }
    }
    setSaving(true)

    const patch = {
      procedure_type_id: form.procedure_type_id ? Number(form.procedure_type_id) : null,
      // التقنية والبصيلات للعمليات بس، والطبيب لغير المنتجات
      technique_id: kind === 'surgery' && form.technique_id ? Number(form.technique_id) : null,
      doctor_id: kind !== 'product' && form.doctor_id ? Number(form.doctor_id) : null,
      grafts: kind === 'surgery' && form.grafts ? Number(form.grafts) : null,
      operation_date: form.operation_date || null,
    }

    // المبالغ تُرسل فقط لمن يملك تعديلها، وإن تغيّرت فعلًا
    // السعر والضريبة: المنسقة + المحاسب + المدير
    if (canEditMoney) {
      const tot = Number(form.total_amount || 0)
      const x = Number(form.tax_amount || 0)
      if (!tot || tot <= 0) { setErr(t('newDeal.err.amountRequired')); setSaving(false); return }
      if (x >= tot) { setErr(t('newDeal.err.taxTooBig')); setSaving(false); return }
      if (tot !== Number(deal.total_amount)) patch.total_amount = tot
      if (x !== Number(deal.tax_amount ?? 0)) {
        patch.tax_amount = x
        patch.tax_note = form.tax_note || null
      }
    }

    const { error } = await supabase.from('deals').update(patch).eq('id', dealId)
    setSaving(false)

    if (error) {
      setErr(error.message?.includes('غير مصرح') ? dbErr(error.message)
           : error.message?.includes('مقفول') ? t('dealDrawer.err.locked')
           : t('addLead.saveFailed') + ' — ' + error.message)
      return
    }

    // تسجيل تغيير المبالغ في سجل العميل
    if (patch.total_amount !== undefined || patch.tax_amount !== undefined) {
      const parts = []
      if (patch.total_amount !== undefined)
        parts.push(`التعاقد ${fmtNum(deal.total_amount)} ← ${fmtNum(patch.total_amount)} ر.س`)
      if (patch.tax_amount !== undefined)
        parts.push(`الضريبة ${fmtNum(deal.tax_amount)} ← ${fmtNum(patch.tax_amount)} ر.س`)
      await supabase.from('activities').insert({
        lead_id: deal.lead_id,
        user_id: profile?.id,
        type: 'note',
        content: `تعديل مالية الديل #${dealId}: ` + parts.join(' · '),
      })
    }

    setEditing(false)
    setFlash(t('dealDrawer.saved'))
    setTimeout(() => setFlash(''), 3000)
    await load(); onChanged()
  }

  async function changeCoordinator(id) {
    const { error } = await supabase.from('deals')
      .update({ coordinator_id: id || null }).eq('id', dealId)
    if (error) {
      setErr(error.message.includes('مقفول') ? t('dealDrawer.err.locked')
           : error.message.includes('غير مصرح') ? t('dealDrawer.err.coordManagerOnly')
           : t('drawer.err.editFailed'))
      return
    }
    await load(); onChanged()
  }

  async function changeAgent(id) {
    if (!id) return
    const { error } = await supabase.from('deals')
      .update({ agent_id: id }).eq('id', dealId)
    if (error) {
      setErr(error.message.includes('مقفول') ? t('dealDrawer.err.locked')
           : error.message.includes('غير مصرح') ? t('dealDrawer.err.agentManagerOnly')
           : t('drawer.err.editFailed'))
      return
    }
    await load(); onChanged()
  }

  async function toggleLock() {
    const { error } = await supabase.from('deals').update({
      is_locked: !deal.is_locked,
      ...(deal.is_locked ? {} : { locked_at: new Date().toISOString() }),
    }).eq('id', dealId)
    if (error) { setErr(t('dealDrawer.err.lockPerm')); return }
    await load(); onChanged()
  }

  if (!deal) return null

  // نتيجة العملية: المنسقة والمحاسب والمدير — السيلز يتابع فقط
  const canSetOutcome = ['super_admin', 'sales_manager', 'coordinator', 'accountant']
    .includes(roleCode)

  // تعديل البيانات التشغيلية · تعديل المبالغ — والقفل يمنع الجميع
  const canEditFields = !deal.is_locked
    && ['super_admin', 'sales_manager', 'coordinator', 'accountant'].includes(roleCode)
  // المبالغ (السعر + الضريبة): المنسقة والمحاسب والمدير
  const canEditMoney = !deal.is_locked
    && ['super_admin', 'sales_manager', 'coordinator', 'accountant'].includes(roleCode)

  // نوع البيع: المحفوظ للعرض، والمختار في الفورم وقت التعديل
  const savedKind = deal.procedure_types?.kind ?? 'surgery'
  const kind = editing ? kindOf(refs.procedures, form.procedure_type_id) : savedKind

  const st = DEAL_STATUS[deal.status]
  const pay = fin ? PAY_STATUS[fin.payment_status] : null

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-soft)' }}>
              {deal.leads?.file_no} · {t('dealDrawer.dealNo', { n: deal.id })}
            </div>
            <h2>{deal.leads?.full_name}</h2>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <span className={'badge ' + st?.cls}>{st ? t(st.label) : ''}</span>
              {pay && <span className={'badge ' + pay.cls}>{t(pay.label)}</span>}
              {deal.is_locked && <span className="badge badge-pending">{t('dealDrawer.locked')} 🔒</span>}
            </div>
          </div>
          <div className="head-actions">
            {hasNav && (
              <div className="nav-pager" title={t('drawer.navHint')}>
                <button className="icon-btn" disabled={!prevDeal}
                  onClick={() => goTo(prevDeal)} title={t('drawer.prev')}>{isRtl ? '→' : '←'}</button>
                <span className="nav-pos">{navIndex + 1} / {navList.length}</span>
                <button className="icon-btn" disabled={!nextDeal}
                  onClick={() => goTo(nextDeal)} title={t('drawer.next')}>{isRtl ? '←' : '→'}</button>
              </div>
            )}
            <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          </div>
        </header>

        {err && <div className="alert alert-error">{err}</div>}
        {flash && <div className="alert alert-ok">{flash}</div>}

        {/* الملخص المالي */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{t('dealDrawer.finance')}</h3>
            {!editing && canEditFields && (
              <button className="btn btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => setEditing(true)}>{t('dealDrawer.editDeal')}</button>
            )}
          </div>
          <div className="fin-grid">
            <div><span>{t('dealDrawer.dueFromClient')}</span>{fmtNum(deal.total_amount)} {SAR}</div>
            <button type="button" className="fin-click" onClick={() => setShowPays(true)}
              title={t('dealPays.open')} aria-label={t('dealPays.open')}>
              <span>{t('common.collected')} <i aria-hidden="true">· {t('dealPays.view')}</i></span>{fmtNum(fin?.collected)} {SAR}
            </button>
            <div className={Number(fin?.remaining) > 0 ? 'fin-danger' : ''}>
              <span>{t('dealDrawer.remainingOnClient')}</span>{fmtNum(fin?.remaining)} {SAR}
            </div>
          </div>

          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)',
          }}>
            <div className="fin-grid">
              <div><span>{t('deal.tax')}</span>{fmtNum(deal.tax_amount)} {SAR}</div>
              <div className="fin-gold"><span>{t('deal.clinicNet')}</span>{fmtNum(deal.net_amount)} {SAR}</div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
              {t('dealDrawer.taxHint')}
            </p>
          </div>
          {deal.tax_note && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              {t('deal.tax')}: {deal.tax_note}
            </p>
          )}
        </div>

        {/* تفاصيل العملية */}
        {editing ? (
          <div className="drawer-section">
            <h3>{t('dealDrawer.editDealData')}</h3>

            <div className="grid-2">
              <div className="field">
                <label>{t('deal.saleType')}</label>
                <select value={form.procedure_type_id}
                  onChange={e => setForm(f => ({ ...f, procedure_type_id: e.target.value }))}>
                  <option value="">—</option>
                  <ProcedureOptions procedures={refs.procedures} />
                </select>
              </div>
              {kind === 'surgery' && (
              <div className="field">
                <label>{t('deal.technique')}</label>
                <select value={form.technique_id}
                  onChange={e => setForm(f => ({ ...f, technique_id: e.target.value }))}>
                  <option value="">—</option>
                  {refs.techniques.map(tq => (
                    <option key={tq.id} value={tq.id}>
                      {tq.name}{tq.name_ar && !isEn ? ` — ${tq.name_ar}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              )}
            </div>

            <div className="grid-2">
              {kind !== 'product' && (
              <div className="field">
                <label>{t('deal.doctor')}</label>
                <select value={form.doctor_id}
                  onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}>
                  <option value="">—</option>
                  {refs.doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              )}
            </div>

            <div className="grid-2">
              {kind === 'surgery' && (
              <div className="field">
                <label>{t('deal.grafts')}</label>
                <input type="number" min={0} value={form.grafts}
                  onChange={e => setForm(f => ({ ...f, grafts: e.target.value }))} />
              </div>
              )}
              <div className="field">
                <label>{dateLabel(kind)}</label>
                <input type="date" value={form.operation_date ?? ''}
                  max={deal.status === 'done' ? todayRiyadh() : undefined}
                  onChange={e => setForm(f => ({ ...f, operation_date: e.target.value }))} />
                {deal.status === 'done' && (
                  <small style={{ color: "var(--ink-soft)", fontSize: 12 }}>{t('dealDrawer.dateMovesRevenue')}</small>
                )}
              </div>
            </div>

            {canEditMoney && (
              <>
                <div style={{ borderTop: '1px dashed var(--line)', margin: '4px 0 14px' }} />
                <div className="grid-2">
                  <div className="field">
                    <label>{t('deal.contractAmount')} ({SAR})</label>
                    <input type="number" min={0} value={form.total_amount}
                      onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('deal.tax')} ({SAR})</label>
                    <input type="number" min={0} value={form.tax_amount}
                      onChange={e => setForm(f => ({ ...f, tax_amount: e.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>{t('dealDrawer.taxNote')}</label>
                  <input value={form.tax_note ?? ''}
                    onChange={e => setForm(f => ({ ...f, tax_note: e.target.value }))} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 12, lineHeight: 1.7 }}>
                  ⚠ {t('dealDrawer.amountsWarn')}
                </div>
              </>
            )}
            {!canEditMoney && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
                {t('dealDrawer.amountsRoles')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? t('common.saving') : t('dealDrawer.saveEdit')}
              </button>
              <button className="btn btn-ghost" disabled={saving}
                onClick={() => { setEditing(false); setErr(''); load() }}>{t('common.cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="drawer-info">
            <div><span>{t('dealDrawer.type')}</span>{dn(deal.procedure_types) || '—'}</div>
            {kind === 'surgery' && <div><span>{t('dealDrawer.techniqueShort')}</span>{deal.techniques?.name ?? '—'}</div>}
            {kind === 'surgery' && <div><span>{t('dealDrawer.graftsShort')}</span>{deal.grafts ? fmtNum(deal.grafts) : '—'}</div>}
            {kind !== 'product' && <div><span>{t('deal.doctor')}</span>{deal.doctors?.full_name ?? '—'}</div>}
            <div><span>{dateLabel(kind)}</span>{fmtDate(deal.operation_date)}</div>
            <div><span>{t('roles.agent')}</span>{deal.agent?.full_name}</div>
            <div><span>{t('lead.coordShort')}</span>{deal.coordinator?.full_name ?? '—'}</div>
            <div><span>{t('lead.branch')}</span>{dn(deal.leads?.branches) || '—'}</div>
          </div>
        )}

        {/* تغيير المنسقة — للمدير فقط
            المنسقة لا تنقل الديل (وعمولته) لزميلتها */}
        {!deal.is_locked && isManager && (
          <div className="drawer-section">
            <h3>{t('lead.coordinator')}</h3>
            <select value={deal.coordinator_id ?? ''} onChange={e => changeCoordinator(e.target.value)}>
              <option value="">{t('dealDrawer.unsetDash')}</option>
              {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <small style={{ color: 'var(--ink-soft)' }}>
              {t('dealDrawer.coordChangeNote')}
            </small>
          </div>
        )}

        {/* تغيير السيلز — للمدير فقط (عمولة الديل تنتقل معه) */}
        {!deal.is_locked && isManager && (
          <div className="drawer-section">
            <h3>{t('roles.agent')}</h3>
            <select value={deal.agent_id ?? ''} onChange={e => changeAgent(e.target.value)}>
              {(refs.agents ?? []).map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
            </select>
            <small style={{ color: 'var(--ink-soft)' }}>
              {t('dealDrawer.agentChangeNote')}
            </small>
          </div>
        )}

        {!deal.is_locked && !isManager && roleCode === 'coordinator' && (
          <div className="drawer-section">
            <h3>{t('lead.coordinator')}</h3>
            <input value={deal.coordinator?.full_name ?? '—'} disabled />
            <small style={{ color: 'var(--ink-soft)' }}>
              {t('dealDrawer.coordContactManager')}
            </small>
          </div>
        )}

        {/* تحديد النتيجة */}
        {(deal.status === 'active' || deal.status === 'waiting') && canSetOutcome ? (
          <div className="drawer-section">
            <h3>{t('dealDrawer.outcome')}</h3>
            {!confirmOutcome ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => {
                  // الافتراضي: تاريخ العملية المسجّل لو مش في المستقبل، وإلا النهارده
                  const op = deal.operation_date && deal.operation_date <= todayRiyadh() ? deal.operation_date : todayRiyadh()
                  setDoneDate(op); setConfirmOutcome('done')
                }}>
                  ✓ {t('dealStatus.done')}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmOutcome('waiting')}>
                  {t('deals.kpi.waiting')}
                </button>
                <button className="btn btn-danger" onClick={() => setConfirmOutcome('lost')}>
                  {t('dealDrawer.loseClient')}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13.5, marginBottom: 10 }}>
                  {confirmOutcome === 'done' && (
                    t(`dealDrawer.confirmDone.${kind === 'product' ? 'product' : kind === 'treatment' ? 'treatment' : 'surgery'}`)
                  )}
                  {confirmOutcome === 'lost' && t('dealDrawer.confirmLost')}
                  {confirmOutcome === 'waiting' && t('dealDrawer.confirmWaiting')}
                </p>
                {confirmOutcome === 'done' && (
                  <div className="field" style={{ marginBottom: 10, maxWidth: 220 }}>
                    <label>{t('dealDrawer.actualDate', { label: dateLabel(kind) })}</label>
                    <input type="date" value={doneDate} max={todayRiyadh()}
                      onChange={e => setDoneDate(e.target.value)} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => setOutcome(confirmOutcome)}>{t('common.confirm')}</button>
                  <button className="btn btn-ghost" onClick={() => setConfirmOutcome(null)}>{t('common.undo')}</button>
                </div>
              </div>
            )}
          </div>
        ) : deal.status === 'done' ? (
          <div className="alert alert-ok">
            {t('dealDrawer.doneNote')}
          </div>
        ) : !canSetOutcome && (
          <div className="drawer-section">
            <h3>{t('dealDrawer.outcome')}</h3>
            <div style={{
              fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--surface)',
              padding: '10px 14px', borderRadius: 8, lineHeight: 1.7,
            }}>
              👁 {t('dealDrawer.outcomeReadOnly')}
            </div>
          </div>
        )}

        {/* القفل المحاسبي */}
        {(isManager || isSuperAdmin) && (
          <div className="drawer-section">
            <h3>{t('dealDrawer.accountingLock')}</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
              {t('dealDrawer.lockHint')}
            </p>
            <button className={'btn ' + (deal.is_locked ? 'btn-ghost' : 'btn-primary')} onClick={toggleLock}>
              {deal.is_locked ? t('dealDrawer.unlock') : t('dealDrawer.lock')}
            </button>
          </div>
        )}
      </aside>
      {showPays && (
        <DealPaymentsModal
          deal={{
            id: deal.id, status: deal.status,
            full_name: deal.leads?.full_name, file_no: deal.leads?.file_no,
            procedure_name: deal.procedure_types?.name_ar, procedure_name_en: deal.procedure_types?.name_en,
            branch_name: deal.leads?.branches?.name, branch_name_en: deal.leads?.branches?.name_en,
            total_amount: deal.total_amount,
            collected: fin?.collected ?? 0,
            open_remaining: Math.max(0, Number(fin?.remaining) || 0),
          }}
          onClose={() => setShowPays(false)}
          onChanged={() => { load(); onChanged?.() }}
        />
      )}
    </div>
  )
}

// تاريخ النهارده بتوقيت الرياض بصيغة YYYY-MM-DD
function todayRiyadh() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
}
