// جدولة أقساط لديل — يقسم المتبقي بالتساوي على عدد الدفعات
// مع معاينة الجدول قبل الحفظ وإمكانية تعديل أي مبلغ يدويًا
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import useT from '../i18n/useT'

export default function ScheduleModal({ onClose, onSaved }) {
  const { t } = useT()
  const SAR = t('common.currency')
  const [deals, setDeals] = useState([])
  const [dealId, setDealId] = useState('')
  const [count, setCount] = useState(3)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [intervalDays, setIntervalDays] = useState(30)
  const [overrides, setOverrides] = useState({})   // تعديلات يدوية على مبالغ الأقساط
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)   // ديلات لها أقساط قائمة

  // الديلات التي عليها متبقٍ ولا أقساط معلقة لها
  useEffect(() => {
    ;(async () => {
      const { data: fin } = await supabase
        .from('v_deal_finance').select('deal_id, remaining').gt('remaining', 0)
      const ids = (fin ?? []).map(f => f.deal_id)
      if (!ids.length) return
      const { data: existing } = await supabase
        .from('installments').select('deal_id').in('status', ['pending', 'partial', 'overdue'])
      const busy_ = new Set((existing ?? []).map(e => e.deal_id))
      const available = ids.filter(i => !busy_.has(i))
      setHiddenCount(ids.length - available.length)
      const { data: dd } = await supabase
        .from('deals').select('id, leads(file_no, full_name)')
        .in('id', available)
        .in('status', ['active', 'waiting', 'done'])
      const finMap = Object.fromEntries((fin ?? []).map(f => [f.deal_id, f.remaining]))
      setDeals((dd ?? []).map(d => ({ ...d, remaining: finMap[d.id] })))
    })()
  }, [])

  const selected = deals.find(d => d.id === Number(dealId))

  // معاينة الجدول: تقسيم متساوٍ والباقي على القسط الأخير
  const plan = useMemo(() => {
    if (!selected || count < 1) return []
    const total = Number(selected.remaining)
    const base = Math.floor(total / count)
    return Array.from({ length: count }, (_, i) => {
      const due = new Date(startDate)
      due.setDate(due.getDate() + i * Number(intervalDays))
      const auto = i === count - 1 ? total - base * (count - 1) : base
      return {
        seq_no: i + 1,
        amount: overrides[i + 1] !== undefined ? Number(overrides[i + 1]) : auto,
        due_date: due.toISOString().slice(0, 10),
      }
    })
  }, [selected, count, startDate, intervalDays, overrides])

  const planTotal = plan.reduce((a, p) => a + p.amount, 0)
  const mismatch = selected && planTotal !== Number(selected.remaining)

  async function save() {
    if (!selected) { setErr(t('payment.err.pickDeal')); return }
    if (mismatch) { setErr(t('schedule.err.mismatch', { sum: fmtNum(planTotal), rem: fmtNum(selected.remaining) })); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.from('installments').insert(
      plan.map(p => ({ deal_id: selected.id, ...p }))
    )
    setBusy(false)
    if (error) { setErr(t('schedule.err.saveFailed') + ' — ' + error.message); return }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <h2>{t('schedule.title')}</h2>
        <p className="sub">{t('schedule.sub')}</p>

        {err && <div className="alert alert-error">{err}</div>}

        {hiddenCount > 0 && (
          <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {t('schedule.hidden', { n: hiddenCount })}
          </div>
        )}

        {deals.length === 0 && hiddenCount === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            {t('schedule.noDeals')}
          </div>
        )}

        <div className="field">
          <label>{t('payment.deal')}</label>
          <select value={dealId} onChange={e => { setDealId(e.target.value); setOverrides({}) }}>
            <option value="">{t('common.pick')}</option>
            {deals.map(d => (
              <option key={d.id} value={d.id}>
                {d.leads?.full_name} · {d.leads?.file_no} · {t('payment.remainingShort')} {fmtNum(d.remaining)} {SAR}
              </option>
            ))}
          </select>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{t('schedule.count')}</label>
            <input type="number" min={1} max={12} value={count}
              onChange={e => { setCount(Number(e.target.value)); setOverrides({}) }} />
          </div>
          <div className="field">
            <label>{t('schedule.intervalDays')}</label>
            <input type="number" min={7} value={intervalDays}
              onChange={e => setIntervalDays(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>{t('schedule.firstDate')}</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>

        {plan.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t('schedule.installment')}</th><th>{t('schedule.amountEditable')}</th><th>{t('schedule.due')}</th></tr></thead>
              <tbody>
                {plan.map(p => (
                  <tr key={p.seq_no}>
                    <td>#{p.seq_no}</td>
                    <td>
                      <input type="number" min={0} value={p.amount}
                        onChange={e => setOverrides(o => ({ ...o, [p.seq_no]: e.target.value }))}
                        style={{ width: 110, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'var(--font-body)' }} />
                    </td>
                    <td>{p.due_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12.5, marginTop: 6, color: mismatch ? 'var(--danger)' : 'var(--ok)' }}>
              {t('common.total')}: {fmtNum(planTotal)} {SAR} {mismatch ? `≠ ${t('deals.sorts.remaining')} ${fmtNum(selected?.remaining)}` : `✓ ${t('schedule.matches')}`}
            </p>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !selected || mismatch}>
            {busy ? t('common.saving') : t('schedule.save')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
