// اللوحة الجانبية للديل
// الملخص المالي (من v_deal_finance) + تحديد النتيجة + تعديل المنسقة + القفل المحاسبي
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchDealFinance, DEAL_STATUS, PAY_STATUS } from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'

export default function DealDrawer({ dealId, refs, onClose, onChanged }) {
  const { isManager, isSuperAdmin, roleCode } = useAuth()
  const [deal, setDeal] = useState(null)
  const [fin, setFin] = useState(null)
  const [err, setErr] = useState('')
  const [confirmOutcome, setConfirmOutcome] = useState(null)  // done | lost | waiting

  const load = useCallback(async () => {
    const [{ data: d }, f] = await Promise.all([
      supabase.from('deals')
        .select(`*, leads(file_no, full_name, phone),
                 agent:profiles!deals_agent_id_fkey(full_name),
                 coordinator:profiles!deals_coordinator_id_fkey(full_name),
                 procedure_types(name_ar), doctors(full_name)`)
        .eq('id', dealId).single(),
      fetchDealFinance(dealId),
    ])
    setDeal(d)
    setFin(f)
  }, [dealId])

  useEffect(() => { load() }, [load])

  async function setOutcome(status) {
    setErr('')
    const { error } = await supabase.from('deals').update({ status }).eq('id', dealId)
    if (error) {
      setErr(error.message?.includes('غير مصرح')
        ? 'تحديد نتيجة العملية يتم عبر المنسقة أو المحاسب أو المدير'
        : 'تعذر تحديث الحالة')
      return
    }
    setConfirmOutcome(null)
    await load()
    onChanged()
  }

  async function changeCoordinator(id) {
    const { error } = await supabase.from('deals')
      .update({ coordinator_id: id || null }).eq('id', dealId)
    if (error) {
      setErr(error.message.includes('مقفول') ? 'الديل مقفول محاسبيًا'
           : error.message.includes('غير مصرح') ? 'تغيير المنسقة متاح للمدير فقط'
           : 'تعذر التعديل')
      return
    }
    await load(); onChanged()
  }

  async function toggleLock() {
    const { error } = await supabase.from('deals').update({
      is_locked: !deal.is_locked,
      ...(deal.is_locked ? {} : { locked_at: new Date().toISOString() }),
    }).eq('id', dealId)
    if (error) { setErr('القفل يتطلب صلاحية أعلى'); return }
    await load(); onChanged()
  }

  if (!deal) return null

  // نتيجة العملية: المنسقة والمحاسب والمدير — السيلز يتابع فقط
  const canSetOutcome = ['super_admin', 'sales_manager', 'coordinator', 'accountant']
    .includes(roleCode)

  const st = DEAL_STATUS[deal.status]
  const pay = fin ? PAY_STATUS[fin.payment_status] : null

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-soft)' }}>
              {deal.leads?.file_no} · ديل #{deal.id}
            </div>
            <h2>{deal.leads?.full_name}</h2>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <span className={'badge ' + st?.cls}>{st?.label}</span>
              {pay && <span className={'badge ' + pay.cls}>{pay.label}</span>}
              {deal.is_locked && <span className="badge badge-pending">مقفول 🔒</span>}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </header>

        {err && <div className="alert alert-error">{err}</div>}

        {/* الملخص المالي */}
        <div className="drawer-section">
          <h3>المالية</h3>
          <div className="fin-grid">
            <div><span>المطلوب من العميل</span>{fmtNum(deal.total_amount)} ر.س</div>
            <div><span>المحصّل</span>{fmtNum(fin?.collected)} ر.س</div>
            <div className={Number(fin?.remaining) > 0 ? 'fin-danger' : ''}>
              <span>المتبقي على العميل</span>{fmtNum(fin?.remaining)} ر.س
            </div>
          </div>

          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)',
          }}>
            <div className="fin-grid">
              <div><span>الضريبة</span>{fmtNum(deal.tax_amount)} ر.س</div>
              <div className="fin-gold"><span>صافي العيادة</span>{fmtNum(deal.net_amount)} ر.س</div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
              العميل مطالَب بالمبلغ كاملًا — الضريبة تُخصم من حصيلة العيادة بعد الاستلام،
              والعمولة تُحسب على الصافي
            </p>
          </div>
          {deal.tax_note && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              الضريبة: {deal.tax_note}
            </p>
          )}
        </div>

        {/* تفاصيل العملية */}
        <div className="drawer-info">
          <div><span>النوع</span>{deal.procedure_types?.name_ar ?? '—'}</div>
          <div><span>البصيلات</span>{deal.grafts ? fmtNum(deal.grafts) : '—'}</div>
          <div><span>الطبيب</span>{deal.doctors?.full_name ?? '—'}</div>
          <div><span>تاريخ العملية</span>{fmtDate(deal.operation_date)}</div>
          <div><span>موظف المبيعات</span>{deal.agent?.full_name}</div>
          <div><span>المنسقة</span>{deal.coordinator?.full_name ?? '—'}</div>
        </div>

        {/* تغيير المنسقة — للمدير فقط
            المنسقة لا تنقل الديل (وعمولته) لزميلتها */}
        {!deal.is_locked && isManager && (
          <div className="drawer-section">
            <h3>المنسقة المسؤولة</h3>
            <select value={deal.coordinator_id ?? ''} onChange={e => changeCoordinator(e.target.value)}>
              <option value="">— غير محددة —</option>
              {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <small style={{ color: 'var(--ink-soft)' }}>
              تغيير المنسقة ينقل عمولة هذا الديل — متاح للمدير فقط
            </small>
          </div>
        )}

        {!deal.is_locked && !isManager && roleCode === 'coordinator' && (
          <div className="drawer-section">
            <h3>المنسقة المسؤولة</h3>
            <input value={deal.coordinator?.full_name ?? '—'} disabled />
            <small style={{ color: 'var(--ink-soft)' }}>
              لتغيير المنسقة المسؤولة تواصل مع المدير
            </small>
          </div>
        )}

        {/* تحديد النتيجة */}
        {(deal.status === 'active' || deal.status === 'waiting') && canSetOutcome ? (
          <div className="drawer-section">
            <h3>نتيجة العملية</h3>
            {!confirmOutcome ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => setConfirmOutcome('done')}>
                  ✓ تمت العملية
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmOutcome('waiting')}>
                  قائمة الانتظار
                </button>
                <button className="btn btn-danger" onClick={() => setConfirmOutcome('lost')}>
                  خسارة العميل
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13.5, marginBottom: 10 }}>
                  {confirmOutcome === 'done' && 'سيُحتسب الإيراد في شهرك الجاري وتُفتح باقة بلازما تلقائيًا. تأكيد؟'}
                  {confirmOutcome === 'lost' && 'سيُصنف العميل كخسارة. تأكيد؟'}
                  {confirmOutcome === 'waiting' && 'سينتقل العميل لقائمة الانتظار. تأكيد؟'}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => setOutcome(confirmOutcome)}>تأكيد</button>
                  <button className="btn btn-ghost" onClick={() => setConfirmOutcome(null)}>تراجع</button>
                </div>
              </div>
            )}
          </div>
        ) : deal.status === 'done' ? (
          <div className="alert alert-ok">
            العملية تمت — باقة البلازما فُتحت تلقائيًا في قسم البلازما
          </div>
        ) : !canSetOutcome && (
          <div className="drawer-section">
            <h3>نتيجة العملية</h3>
            <div style={{
              fontSize: 12.5, color: 'var(--ink-soft)', background: 'var(--surface)',
              padding: '10px 14px', borderRadius: 8, lineHeight: 1.7,
            }}>
              👁 تحديد نتيجة العملية يتم عبر المنسقة أو المحاسب أو المدير —
              يمكنك متابعة حالة عميلك من هنا
            </div>
          </div>
        )}

        {/* القفل المحاسبي */}
        {(isManager || isSuperAdmin) && (
          <div className="drawer-section">
            <h3>القفل المحاسبي</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
              بعد القفل لا يمكن تعديل الديل إلا بصلاحية المدير العام — ويُسجل كل شيء في سجل التدقيق
            </p>
            <button className={'btn ' + (deal.is_locked ? 'btn-ghost' : 'btn-primary')} onClick={toggleLock}>
              {deal.is_locked ? 'فك القفل' : 'قفل الديل'}
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
