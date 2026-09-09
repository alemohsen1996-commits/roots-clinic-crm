// التحصيلات — سجل الدفعات + التأكيد المحاسبي + نظام إلغاء بموافقة
// المنسقة تطلب الإلغاء، المدير/المحاسب يوافق أو يرفض
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum, fmtDateTime } from '../lib/format'
import AddPaymentModal from './AddPaymentModal'

const METHOD_AR = {
  cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل',
  tabby: 'تابي', tamara: 'تمارا', other: 'أخرى',
}

export default function PaymentsPage() {
  const { profile, isManager, roleCode } = useAuth()
  const canConfirm = isManager || roleCode === 'accountant'
  const canApproveVoid = isManager || roleCode === 'accountant'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [voidingId, setVoidingId] = useState(null)   // الدفعة الجاري طلب إلغائها
  const [voidReason, setVoidReason] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('payments')
      .select(`
        id, receipt_no, amount, method, paid_at, reference, notes, confirmed_at,
        status, void_reason,
        deals(id, leads(file_no, full_name)),
        received:profiles!payments_received_by_fkey(full_name),
        confirmer:profiles!payments_confirmed_by_fkey(full_name),
        void_requester:profiles!payments_void_requested_by_fkey(full_name)
      `)
      .order('paid_at', { ascending: false })
      .limit(300)
    if (onlyUnconfirmed) q = q.is('confirmed_at', null)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [onlyUnconfirmed])

  useEffect(() => { load() }, [load])

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  // ملاحظة: الدفعات تُسجَّل عبر record_payment لضمان تحديث القسط المرتبط

  async function confirm(id) {
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
    }).eq('id', id)
    // بدون هذا التحقق كان الزر يُضغط بلا أي أثر عند رفض RLS
    if (error) { flash('تعذر التأكيد — ' + error.message); return }
    flash('تم تأكيد الدفعة محاسبيًا')
    load()
  }

  async function submitVoidRequest() {
    if (!voidReason.trim()) return
    const { error } = await supabase.rpc('request_payment_void', {
      p_payment_id: voidingId, p_reason: voidReason.trim(),
    })
    setVoidingId(null); setVoidReason('')
    if (error) { flash('تعذر إرسال طلب الإلغاء'); return }
    flash('تم إرسال طلب الإلغاء — بانتظار موافقة الإدارة')
    load()
  }

  async function approveVoid(id) {
    const { error } = await supabase.rpc('approve_payment_void', { p_payment_id: id })
    if (error) { flash('تعذر اعتماد الإلغاء'); return }
    flash('تم إلغاء الدفعة'); load()
  }

  async function rejectVoid(id) {
    const { error } = await supabase.rpc('reject_payment_void', { p_payment_id: id })
    if (error) { flash('تعذر رفض الطلب'); return }
    flash('تم رفض طلب الإلغاء — الدفعة سارية'); load()
  }

  // الدفعات النشطة فقط تدخل في الإجمالي
  const total = rows.filter(r => r.status === 'active').reduce((a, r) => a + Number(r.amount), 0)
  const pendingVoids = rows.filter(r => r.status === 'void_requested')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>التحصيلات</h1>
          <div className="hint">{rows.length} دفعة · محصّل نشط {fmtNum(total)} ر.س</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ تسجيل دفعة</button>
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* طلبات الإلغاء المعلّقة — للمدير/المحاسب */}
      {canApproveVoid && pendingVoids.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--warn)' }}>
          <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 15, color: 'var(--warn)' }}>طلبات إلغاء بانتظار موافقتك</h2>
            <span className="badge badge-pending">{pendingVoids.length}</span>
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>الإيصال</th><th>العميل</th><th>المبلغ</th><th>سبب الإلغاء</th><th>طلبها</th><th></th></tr>
            </thead>
            <tbody>
              {pendingVoids.map(p => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{p.receipt_no}</td>
                  <td>{p.deals?.leads?.full_name}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(p.amount)} ر.س</td>
                  <td>{p.void_reason}</td>
                  <td>{p.void_requester?.full_name ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger" onClick={() => approveVoid(p.id)}>اعتماد الإلغاء</button>
                    <button className="btn btn-ghost" onClick={() => rejectVoid(p.id)}>رفض</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card filters-bar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
          <input type="checkbox" checked={onlyUnconfirmed}
            onChange={e => setOnlyUnconfirmed(e.target.checked)}
            style={{ width: 16, height: 16 }} />
          غير المؤكدة محاسبيًا فقط
        </label>
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <strong>لا توجد دفعات</strong>
          سجّل أول تحصيل وسيحصل على رقم إيصال تلقائي
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>الإيصال</th><th>العميل</th><th>المبلغ</th><th>الطريقة</th>
                <th>التاريخ</th><th>سجّلتها</th><th>التأكيد</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isVoid = p.status === 'void'
                const isVoidReq = p.status === 'void_requested'
                return (
                  <tr key={p.id} style={isVoid ? { opacity: .5, textDecoration: 'line-through' } : {}}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{p.receipt_no}</td>
                    <td style={{ fontWeight: 600 }}>
                      {p.deals?.leads?.full_name}
                      <small style={{ color: 'var(--ink-soft)' }}> · {p.deals?.leads?.file_no}</small>
                    </td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(p.amount)} ر.س</td>
                    <td>{METHOD_AR[p.method] ?? p.method}{p.reference && <small style={{ color: 'var(--ink-soft)' }}> · {p.reference}</small>}</td>
                    <td>{fmtDateTime(p.paid_at)}</td>
                    <td>{p.received?.full_name ?? '—'}</td>
                    <td>
                      {isVoid
                        ? <span className="badge badge-suspended">ملغية</span>
                        : isVoidReq
                          ? <span className="badge badge-pending">طلب إلغاء</span>
                          : p.confirmed_at
                            ? <span className="badge badge-active">مؤكدة · {p.confirmer?.full_name}</span>
                            : canConfirm
                              ? <button className="btn btn-ghost" onClick={() => confirm(p.id)}>تأكيد</button>
                              : <span className="badge badge-pending">بانتظار المحاسب</span>}
                    </td>
                    <td>
                      {p.status === 'active' && (
                        <button className="btn btn-ghost" style={{ padding: '6px 12px', color: 'var(--danger)' }}
                          onClick={() => { setVoidingId(p.id); setVoidReason('') }}>
                          طلب إلغاء
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddPaymentModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {/* نافذة سبب الإلغاء */}
      {voidingId && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setVoidingId(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2>طلب إلغاء دفعة</h2>
            <p className="sub">اكتب سبب الإلغاء — سيراجعه المدير أو المحاسب قبل الاعتماد</p>
            <div className="field">
              <label>سبب الإلغاء</label>
              <input value={voidReason} onChange={e => setVoidReason(e.target.value)}
                placeholder="مثال: خطأ في المبلغ المُدخل"
                onKeyDown={e => e.key === 'Enter' && submitVoidRequest()} autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={submitVoidRequest} disabled={!voidReason.trim()}>
                إرسال الطلب
              </button>
              <button className="btn btn-ghost" onClick={() => setVoidingId(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
