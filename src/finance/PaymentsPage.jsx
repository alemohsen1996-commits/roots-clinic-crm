// التحصيلات — سجل الدفعات + التأكيد المحاسبي + نظام إلغاء بموافقة
// المنسقة تطلب الإلغاء، المدير/المحاسب يوافق أو يرفض
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum, fmtDateTime } from '../lib/format'

// تاريخ مختصر يمنع تكسّر الخلية في جدول متعدد الأعمدة
const shortDT = (d) => {
  if (!d) return '—'
  const x = new Date(d)
  return x.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })
       + ' · ' + x.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}
import AddPaymentModal from './AddPaymentModal'

const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

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
        deals(id, leads(file_no, full_name, phone),
              agent:profiles!deals_agent_id_fkey(full_name),
              coordinator:profiles!deals_coordinator_id_fkey(full_name)),
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
          <div className="table-scroll" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="table sticky-head compact">
            <thead>
              <tr>
                <th>الإيصال</th><th>العميل</th><th>الهاتف</th><th>السيلز</th><th>المنسقة</th>
                <th>المبلغ</th><th>الطريقة</th><th>التاريخ</th><th>سجّلتها</th>
                <th>التأكيد</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isVoid = p.status === 'void'
                const isVoidReq = p.status === 'void_requested'
                return (
                  <tr key={p.id} style={isVoid ? { opacity: .5, textDecoration: 'line-through' } : {}}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {p.receipt_no}
                    </td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {p.deals?.leads?.full_name}
                      <small style={{ color: 'var(--ink-soft)', display: 'block', fontWeight: 400 }}>
                        {p.deals?.leads?.file_no}
                      </small>
                    </td>
                    <td>
                      <div className="phone-cell">
                        <span dir="ltr">{p.deals?.leads?.phone ?? '—'}</span>
                        {p.deals?.leads?.phone && (
                          <>
                            <a className="icon-btn" href={`tel:${p.deals.leads.phone}`} title="اتصال">☎</a>
                            <a className="icon-btn" title="واتساب" target="_blank" rel="noreferrer"
                              href={`https://wa.me/${waNumber(p.deals.leads.phone)}`}>
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                              </svg>
                            </a>
                            <button className="icon-btn" title="نسخ الرقم"
                              onClick={() => navigator.clipboard?.writeText(p.deals.leads.phone)}>⧉</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{p.deals?.agent?.full_name ?? '—'}</td>
                    <td style={{ fontSize: 12.5 }}>{p.deals?.coordinator?.full_name ?? '—'}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fmtNum(p.amount)} ر.س
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {METHOD_AR[p.method] ?? p.method}
                      {p.reference && <small style={{ color: 'var(--ink-soft)', display: 'block' }}>{p.reference}</small>}
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={fmtDateTime(p.paid_at)}>
                      {shortDT(p.paid_at)}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{p.received?.full_name ?? '—'}</td>
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
