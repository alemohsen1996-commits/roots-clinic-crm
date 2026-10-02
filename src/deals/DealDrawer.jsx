// اللوحة الجانبية للديل
// الملخص المالي (من v_deal_finance) + تحديد النتيجة + تعديل المنسقة + القفل المحاسبي
import { useCallback, useEffect, useState } from 'react'
import { salesLabel } from '../lib/people'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fetchDealFinance, DEAL_STATUS, PAY_STATUS, kindOf, dateLabel } from './useDealRefs'
import ProcedureOptions from './ProcedureOptions'
import { fmtNum, fmtDate } from '../lib/format'

export default function DealDrawer({ dealId, refs, siblings, onNavigate, onClose, onChanged }) {
  const { isManager, isSuperAdmin, roleCode, profile } = useAuth()
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

  const load = useCallback(async () => {
    const [{ data: d }, f] = await Promise.all([
      supabase.from('deals')
        .select(`*, leads(file_no, full_name, phone, branches(name)),
                 agent:profiles!deals_agent_id_fkey(full_name),
                 coordinator:profiles!deals_coordinator_id_fkey(full_name),
                 procedure_types(name_ar, kind), techniques(name, name_ar), doctors(full_name)`)
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
      if (!doneDate) { setErr('حدّد تاريخ العملية'); return }
      if (doneDate > todayRiyadh()) { setErr('تاريخ العملية لا يمكن أن يكون في المستقبل'); return }
      patch.operation_date = doneDate
    }
    const { error } = await supabase.from('deals').update(patch).eq('id', dealId)
    if (error) {
      setErr(error.message?.includes('غير مصرح')
        ? 'تحديد نتيجة العملية يتم عبر المنسقة أو المحاسب أو المدير'
        : error.message?.includes('المستقبل')
          ? 'لا يمكن إتمام العملية بتاريخ في المستقبل — اختر تاريخ اليوم أو قبله'
          : 'تعذر تحديث الحالة')
      return
    }
    setConfirmOutcome(null)
    await load()
    onChanged()
  }

  async function saveEdit() {
    setErr('')
    if (deal.status === 'done') {
      if (!form.operation_date) { setErr('العملية تمت — تاريخ العملية مطلوب'); return }
      if (form.operation_date > todayRiyadh()) { setErr('تاريخ العملية لا يمكن أن يكون في المستقبل'); return }
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
  // نوع البيع: المحفوظ للعرض، والمختار في الفورم وقت التعديل
  const savedKind = deal.procedure_types?.kind ?? 'surgery'
  const kind = editing ? kindOf(refs.procedures, form.procedure_type_id) : savedKind
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
          <div className="head-actions">
            {hasNav && (
              <div className="nav-pager" title="استخدم ← و → للتنقّل">
                <button className="icon-btn" disabled={!prevDeal}
                  onClick={() => goTo(prevDeal)} title="السابق">→</button>
                <span className="nav-pos">{navIndex + 1} من {navList.length}</span>
                <button className="icon-btn" disabled={!nextDeal}
                  onClick={() => goTo(nextDeal)} title="التالي">←</button>
              </div>
            )}
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
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
            <h3>تعديل بيانات الديل</h3>

            <div className="grid-2">
              <div className="field">
                <label>نوع البيع</label>
                <select value={form.procedure_type_id}
                  onChange={e => setForm(f => ({ ...f, procedure_type_id: e.target.value }))}>
                  <option value="">—</option>
                  <ProcedureOptions procedures={refs.procedures} />
                </select>
              </div>
              {kind === 'surgery' && (
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
              )}
            </div>

            <div className="grid-2">
              {kind !== 'product' && (
              <div className="field">
                <label>الطبيب</label>
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
                <label>عدد البصيلات</label>
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
                  <small style={{ color: "var(--ink-soft)", fontSize: 12 }}>تعديل التاريخ ينقل الإيراد والعمولة لشهره تلقائيًا</small>
                )}
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
            {kind === 'surgery' && <div><span>التقنية</span>{deal.techniques?.name ?? '—'}</div>}
            {kind === 'surgery' && <div><span>البصيلات</span>{deal.grafts ? fmtNum(deal.grafts) : '—'}</div>}
            {kind !== 'product' && <div><span>الطبيب</span>{deal.doctors?.full_name ?? '—'}</div>}
            <div><span>{dateLabel(kind)}</span>{fmtDate(deal.operation_date)}</div>
            <div><span>موظف المبيعات</span>{deal.agent?.full_name}</div>
            <div><span>المنسقة</span>{deal.coordinator?.full_name ?? '—'}</div>
            <div><span>الفرع</span>{deal.leads?.branches?.name ?? '—'}</div>
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
              {(refs.agents ?? []).map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
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
                <button className="btn btn-primary" onClick={() => {
                  // الافتراضي: تاريخ العملية المسجّل لو مش في المستقبل، وإلا النهارده
                  const op = deal.operation_date && deal.operation_date <= todayRiyadh() ? deal.operation_date : todayRiyadh()
                  setDoneDate(op); setConfirmOutcome('done')
                }}>
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
                  {confirmOutcome === 'done' && (
                    kind === 'product'
                      ? 'سيُحتسب الإيراد في شهر تاريخ التسليم. تأكيد؟'
                      : kind === 'treatment'
                        ? 'سيُحتسب الإيراد في شهر أول جلسة، وتُفتح باقة الجلسات في قسم البلازما تلقائيًا. تأكيد؟'
                        : 'سيُحتسب الإيراد والعمولة في شهر تاريخ العملية، وتُفتح باقة بلازما تلقائيًا. تأكيد؟'
                  )}
                  {confirmOutcome === 'lost' && 'سيُصنف العميل كخسارة. تأكيد؟'}
                  {confirmOutcome === 'waiting' && 'سينتقل العميل لقائمة الانتظار. تأكيد؟'}
                </p>
                {confirmOutcome === 'done' && (
                  <div className="field" style={{ marginBottom: 10, maxWidth: 220 }}>
                    <label>{dateLabel(kind)} الفعلي</label>
                    <input type="date" value={doneDate} max={todayRiyadh()}
                      onChange={e => setDoneDate(e.target.value)} />
                  </div>
                )}
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

// تاريخ النهارده بتوقيت الرياض بصيغة YYYY-MM-DD
function todayRiyadh() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
}
