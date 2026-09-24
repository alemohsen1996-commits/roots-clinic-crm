// اللوحة الجانبية للديل
// الملخص المالي (من v_deal_finance) + تحديد النتيجة + تعديل المنسقة + القفل المحاسبي
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchDealFinance, DEAL_STATUS, PAY_STATUS } from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'

export default function DealDrawer({ dealId, refs, onClose, onChanged }) {
  const { isManager, isSuperAdmin, roleCode, profile } = useAuth()
  const [deal, setDeal] = useState(null)
  const [fin, setFin] = useState(null)
  const [err, setErr] = useState('')
  const [confirmOutcome, setConfirmOutcome] = useState(null)  // done | lost | waiting
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    const [{ data: d }, f] = await Promise.all([
      supabase.from('deals')
        .select(`*, leads(file_no, full_name, phone),
                 agent:profiles!deals_agent_id_fkey(full_name),
                 coordinator:profiles!deals_coordinator_id_fkey(full_name),
                 procedure_types(name_ar), techniques(name, name_ar), doctors(full_name)`)
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

  async function saveEdit() {
    setErr(''); setSaving(true)

    const patch = {
      procedure_type_id: form.procedure_type_id ? Number(form.procedure_type_id) : null,
      technique_id: form.technique_id ? Number(form.technique_id) : null,
      doctor_id: form.doctor_id ? Number(form.doctor_id) : null,
      grafts: form.grafts ? Number(form.grafts) : null,
      operation_date: form.operation_date || null,
    }

    // المبالغ تُرسل فقط لمن يملك تعديلها، وإن تغيّرت فعلًا
    if (canEditMoney) {
      const t = Number(form.total_amount || 0)
      const x = Number(form.tax_amount || 0)
      if (!t || t <= 0) { setErr('أدخل قيمة التعاقد'); setSaving(false); return }
      if (x >= t) { setErr('الضريبة لا يمكن أن تساوي قيمة التعاقد أو تتجاوزها'); setSaving(false); return }
      if (t !== Number(deal.total_amount) || x !== Number(deal.tax_amount ?? 0)) {
        patch.total_amount = t
        patch.tax_amount = x
        patch.tax_note = form.tax_note || null
      }
    }

    const { error } = await supabase.from('deals').update(patch).eq('id', dealId)
    setSaving(false)

    if (error) {
      setErr(error.message?.includes('غير مصرح') ? error.message
           : error.message?.includes('مقفول') ? 'الديل مقفول محاسبيًا'
           : 'تعذر الحفظ — ' + error.message)
      return
    }

    // تسجيل تغيير المبالغ في سجل العميل
    if (patch.total_amount !== undefined) {
      await supabase.from('activities').insert({
        lead_id: deal.lead_id,
        user_id: profile?.id,
        type: 'note',
        content: `تعديل مالية الديل #${dealId}: `
          + `التعاقد ${fmtNum(deal.total_amount)} ← ${fmtNum(patch.total_amount)} ر.س · `
          + `الضريبة ${fmtNum(deal.tax_amount)} ← ${fmtNum(patch.tax_amount)} ر.س`,
      })
    }

    setEditing(false)
    setFlash('تم حفظ التعديل')
    setTimeout(() => setFlash(''), 3000)
    await load(); onChanged()
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

  async function changeAgent(id) {
    if (!id) return
    const { error } = await supabase.from('deals')
      .update({ agent_id: id }).eq('id', dealId)
    if (error) {
      setErr(error.message.includes('مقفول') ? 'الديل مقفول محاسبيًا'
           : error.message.includes('غير مصرح') ? 'تغيير السيلز متاح للمدير فقط'
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

  // تعديل البيانات التشغيلية · تعديل المبالغ — والقفل يمنع الجميع
  const canEditFields = !deal.is_locked
    && ['super_admin', 'sales_manager', 'coordinator', 'accountant'].includes(roleCode)
  const canEditMoney = !deal.is_locked
    && ['super_admin', 'sales_manager', 'accountant'].includes(roleCode)

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
        {flash && <div className="alert alert-ok">{flash}</div>}

        {/* الملخص المالي */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>المالية</h3>
            {!editing && canEditFields && (
              <button className="btn btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => setEditing(true)}>تعديل الديل</button>
            )}
          </div>
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
        {editing ? (
          <div className="drawer-section">
            <h3>تعديل بيانات العملية</h3>

            <div className="grid-2">
              <div className="field">
                <label>نوع العملية</label>
                <select value={form.procedure_type_id}
                  onChange={e => setForm(f => ({ ...f, procedure_type_id: e.target.value }))}>
                  <option value="">—</option>
                  {refs.procedures.map(p => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
                </select>
              </div>
              <div className="field">
                <label>التقنية المستخدمة</label>
                <select value={form.technique_id}
                  onChange={e => setForm(f => ({ ...f, technique_id: e.target.value }))}>
                  <option value="">—</option>
                  {refs.techniques.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.name_ar ? ` — ${t.name_ar}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>الطبيب</label>
                <select value={form.doctor_id}
                  onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}>
                  <option value="">—</option>
                  {refs.doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>عدد البصيلات</label>
                <input type="number" min={0} value={form.grafts}
                  onChange={e => setForm(f => ({ ...f, grafts: e.target.value }))} />
              </div>
              <div className="field">
                <label>تاريخ العملية</label>
                <input type="date" value={form.operation_date ?? ''}
                  onChange={e => setForm(f => ({ ...f, operation_date: e.target.value }))} />
              </div>
            </div>

            {canEditMoney ? (
              <>
                <div style={{ borderTop: '1px dashed var(--line)', margin: '4px 0 14px' }} />
                <div className="grid-2">
                  <div className="field">
                    <label>قيمة التعاقد (ر.س)</label>
                    <input type="number" min={0} value={form.total_amount}
                      onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>الضريبة (ر.س)</label>
                    <input type="number" min={0} value={form.tax_amount}
                      onChange={e => setForm(f => ({ ...f, tax_amount: e.target.value }))} />
                  </div>
                </div>
                <div className="field">
                  <label>ملاحظة على الضريبة</label>
                  <input value={form.tax_note ?? ''}
                    onChange={e => setForm(f => ({ ...f, tax_note: e.target.value }))} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 12, lineHeight: 1.7 }}>
                  ⚠ تعديل المبالغ يغيّر الإيراد والعمولة وحالة السداد — ويُسجَّل في سجل العميل
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
                تعديل المبالغ يتم عبر المحاسب أو المدير
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? 'جارٍ الحفظ…' : 'حفظ التعديل'}
              </button>
              <button className="btn btn-ghost" disabled={saving}
                onClick={() => { setEditing(false); setErr(''); load() }}>إلغاء</button>
            </div>
          </div>
        ) : (
          <div className="drawer-info">
            <div><span>النوع</span>{deal.procedure_types?.name_ar ?? '—'}</div>
            <div><span>التقنية</span>{deal.techniques?.name ?? '—'}</div>
            <div><span>البصيلات</span>{deal.grafts ? fmtNum(deal.grafts) : '—'}</div>
            <div><span>الطبيب</span>{deal.doctors?.full_name ?? '—'}</div>
            <div><span>تاريخ العملية</span>{fmtDate(deal.operation_date)}</div>
            <div><span>موظف المبيعات</span>{deal.agent?.full_name}</div>
            <div><span>المنسقة</span>{deal.coordinator?.full_name ?? '—'}</div>
          </div>
        )}

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

        {/* تغيير السيلز — للمدير فقط (عمولة الديل تنتقل معه) */}
        {!deal.is_locked && isManager && (
          <div className="drawer-section">
            <h3>موظف المبيعات (السيلز)</h3>
            <select value={deal.agent_id ?? ''} onChange={e => changeAgent(e.target.value)}>
              {(refs.agents ?? []).map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
            <small style={{ color: 'var(--ink-soft)' }}>
              تغيير السيلز ينقل عمولة هذا الديل — متاح للمدير فقط
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
