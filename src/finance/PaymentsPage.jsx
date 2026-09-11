// التحصيلات — سجل الدفعات + التأكيد المحاسبي + نظام إلغاء بموافقة
// المنسقة تطلب الإلغاء، المدير/المحاسب يوافق أو يرفض
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum, fmtDateTime } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import AddPaymentModal from './AddPaymentModal'

const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

// تاريخ مختصر يمنع تكسّر الخلية في جدول متعدد الأعمدة
const shortDT = (d) => {
  if (!d) return '—'
  const x = new Date(d)
  return x.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })
       + ' · ' + x.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}

const METHOD_AR = {
  cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل',
  tabby: 'تابي', tamara: 'تمارا', other: 'أخرى',
}

const PAGE = 100
const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString().slice(0, 10)

const SELECT = `
  id, receipt_no, amount, method, paid_at, reference, notes, confirmed_at,
  status, void_reason,
  deals(id, leads(file_no, full_name, phone),
        agent:profiles!deals_agent_id_fkey(full_name),
        coordinator:profiles!deals_coordinator_id_fkey(full_name)),
  received:profiles!payments_received_by_fkey(full_name),
  confirmer:profiles!payments_confirmed_by_fkey(full_name),
  void_requester:profiles!payments_void_requested_by_fkey(full_name)
`

export default function PaymentsPage() {
  const { profile, isManager, roleCode } = useAuth()
  const canConfirm = isManager || roleCode === 'accountant'
  const canApproveVoid = isManager || roleCode === 'accountant'

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [sums, setSums] = useState(null)

  // الفلاتر
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [method, setMethod] = useState('')
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [voidingId, setVoidingId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  const fromTs = from ? from + 'T00:00:00' : null
  const toTs = to ? to + 'T23:59:59' : null

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('payments').select(SELECT, { count: 'exact' })
      .order('paid_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)

    if (fromTs) q = q.gte('paid_at', fromTs)
    if (toTs)   q = q.lte('paid_at', toTs)
    if (method) q = q.eq('method', method)
    if (onlyUnconfirmed) q = q.is('confirmed_at', null)
    if (search.trim()) q = q.ilike('receipt_no', `%${search.trim()}%`)

    const { data, count } = await q
    setRows(data ?? [])
    setTotal(count ?? 0)

    // الإجماليات تُحسب في القاعدة على كامل النتائج لا على الصفحة المعروضة
    const { data: t } = await supabase.rpc('payment_totals', {
      p_from: fromTs, p_to: toTs,
      p_method: method || null,
      p_search: search.trim() || null,
    })
    setSums(t ?? null)
    setLoading(false)
  }, [page, fromTs, toTs, method, onlyUnconfirmed, search])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0); setSelected(new Set()) }, [fromTs, toTs, method, onlyUnconfirmed, search])

  const loadStats = useCallback(async () => {
    const { data } = await supabase.rpc('payment_quick_stats')
    setStats(data ?? null)
  }, [])
  useEffect(() => { loadStats() }, [loadStats])

  // ---------- الإجراءات ----------
  async function confirm(id) {
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { flash('تعذر التأكيد — ' + error.message); return }
    flash('تم تأكيد الدفعة محاسبيًا')
    load(); loadStats()
  }

  async function confirmBulk() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`تأكيد ${ids.length} دفعة محاسبيًا؟`)) return
    setBusy(true)
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).in('id', ids)
    setBusy(false)
    if (error) { flash('تعذر التأكيد — ' + error.message); return }
    flash(`تم تأكيد ${ids.length} دفعة`)
    setSelected(new Set())
    load(); loadStats()
  }

  async function submitVoidRequest() {
    if (!voidReason.trim()) return
    const { error } = await supabase.rpc('request_payment_void', {
      p_payment_id: voidingId, p_reason: voidReason.trim(),
    })
    setVoidingId(null); setVoidReason('')
    if (error) { flash('تعذر إرسال طلب الإلغاء'); return }
    flash('تم إرسال طلب الإلغاء — بانتظار موافقة الإدارة')
    load(); loadStats()
  }

  async function approveVoid(id) {
    const { error } = await supabase.rpc('approve_payment_void', { p_payment_id: id })
    if (error) { flash('تعذر اعتماد الإلغاء'); return }
    flash('تم إلغاء الدفعة'); load(); loadStats()
  }

  async function rejectVoid(id) {
    const { error } = await supabase.rpc('reject_payment_void', { p_payment_id: id })
    if (error) { flash('تعذر رفض الطلب'); return }
    flash('تم رفض طلب الإلغاء — الدفعة سارية'); load(); loadStats()
  }

  // ---------- التصدير ----------
  async function doExport() {
    setBusy(true)
    const all = []
    for (let off = 0; off < 20000; off += 1000) {
      let q = supabase.from('payments').select(SELECT)
        .order('paid_at', { ascending: false }).range(off, off + 999)
      if (fromTs) q = q.gte('paid_at', fromTs)
      if (toTs)   q = q.lte('paid_at', toTs)
      if (method) q = q.eq('method', method)
      if (onlyUnconfirmed) q = q.is('confirmed_at', null)
      if (search.trim()) q = q.ilike('receipt_no', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) { setBusy(false); flash('تعذر التصدير'); return }
      all.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    setBusy(false)

    const ST = { active: 'سارية', void: 'ملغية', void_requested: 'طلب إلغاء' }
    exportCsv(
      `payments-${from || 'all'}-to-${to || 'now'}.csv`,
      ['الإيصال', 'العميل', 'رقم الملف', 'الهاتف', 'السيلز', 'المنسقة',
       'المبلغ', 'الطريقة', 'المرجع', 'التاريخ', 'سجّلتها', 'الحالة', 'التأكيد'],
      all.map(p => [
        p.receipt_no, p.deals?.leads?.full_name, p.deals?.leads?.file_no,
        p.deals?.leads?.phone, p.deals?.agent?.full_name, p.deals?.coordinator?.full_name,
        p.amount, METHOD_AR[p.method] ?? p.method, p.reference ?? '',
        fmtDateTime(p.paid_at), p.received?.full_name ?? '',
        ST[p.status] ?? p.status, p.confirmed_at ? 'مؤكدة' : 'غير مؤكدة',
      ])
    )
  }

  // ---------- التحديد ----------
  const confirmable = rows.filter(r => r.status === 'active' && !r.confirmed_at)
  const allPageSelected = confirmable.length > 0 && confirmable.every(r => selected.has(r.id))

  function toggleOne(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleAll(on) {
    setSelected(prev => {
      const n = new Set(prev)
      confirmable.forEach(r => on ? n.add(r.id) : n.delete(r.id))
      return n
    })
  }

  const pendingVoids = rows.filter(r => r.status === 'void_requested')
  const totalPages = Math.max(1, Math.ceil(total / PAGE))
  const hasFilters = search || from || to || method || onlyUnconfirmed

  return (
    <>
      <div className="page-head">
        <div>
          <h1>التحصيلات</h1>
          <div className="hint">
            {sums
              ? `${fmtNum(sums.active_count)} دفعة سارية · ${fmtNum(sums.active_total)} ر.س`
              : '—'}
            {hasFilters && <span style={{ color: 'var(--gold)' }}> (ضمن الفلاتر)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canConfirm && (
            <button className="btn btn-ghost" onClick={doExport} disabled={busy || !total}>
              {busy ? '…' : '⬇ تصدير'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ تسجيل دفعة</button>
        </div>
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* كروت الملخص */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
          {[
            { label: 'تحصيلات اليوم', value: fmtNum(stats.today) + ' ر.س',
              sub: `${fmtNum(stats.today_count)} دفعة`, gold: true },
            { label: 'تحصيلات الشهر', value: fmtNum(stats.month) + ' ر.س',
              sub: `${fmtNum(stats.month_count)} دفعة`, gold: true },
            { label: 'بانتظار التأكيد', value: fmtNum(stats.unconfirmed),
              sub: fmtNum(stats.unconfirmed_total) + ' ر.س',
              warn: stats.unconfirmed > 0,
              onClick: () => { setOnlyUnconfirmed(true); setFrom(''); setTo('') } },
            { label: 'صافي إيراد الشهر', value: fmtNum(stats.net_month) + ' ر.س',
              sub: `${fmtNum(stats.net_month_count)} عملية · ضريبة ${fmtNum(stats.tax_month)} ر.س`,
              gold: true },
            { label: 'طلبات إلغاء', value: fmtNum(stats.void_pending),
              sub: stats.void_pending > 0 ? 'تحتاج قرارك' : 'لا شيء',
              danger: stats.void_pending > 0 },
          ].map(c => (
            <div key={c.label} className="card"
              style={{ padding: 16, cursor: c.onClick ? 'pointer' : 'default' }}
              onClick={c.onClick}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.label}</div>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21,
                color: c.gold ? 'var(--gold)' : c.danger ? 'var(--danger)'
                     : c.warn ? 'var(--warn)' : 'var(--ink)',
              }}>{c.value}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* طلبات الإلغاء المعلّقة */}
      {canApproveVoid && pendingVoids.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--warn)' }}>
          <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 15, color: 'var(--warn)' }}>طلبات إلغاء بانتظار موافقتك</h2>
            <span className="badge badge-pending">{pendingVoids.length}</span>
          </div>
          <table className="table compact" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>الإيصال</th><th>العميل</th><th>المبلغ</th><th>سبب الإلغاء</th><th>طلبها</th><th></th></tr>
            </thead>
            <tbody>
              {pendingVoids.map(p => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.receipt_no}</td>
                  <td>{p.deals?.leads?.full_name}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {fmtNum(p.amount)} ر.س
                  </td>
                  <td>{p.void_reason}</td>
                  <td>{p.void_requester?.full_name ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" onClick={() => approveVoid(p.id)}>اعتماد</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rejectVoid(p.id)}>رفض</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* الفلاتر */}
      <div className="card filters-bar">
        <input className="filter-search" placeholder="بحث برقم الإيصال…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>من</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>إلى</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={method} onChange={e => setMethod(e.target.value)}>
          <option value="">كل الطرق</option>
          {Object.entries(METHOD_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={'chip' + (onlyUnconfirmed ? ' on' : '')}
          onClick={() => setOnlyUnconfirmed(v => !v)}>
          غير المؤكدة
        </button>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setFrom(today()); setTo(today()) }}>اليوم</button>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setFrom(monthStart()); setTo(today()) }}>هذا الشهر</button>
        {hasFilters && (
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setSearch(''); setFrom(''); setTo(''); setMethod(''); setOnlyUnconfirmed(false) }}>
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* شريط التأكيد الجماعي */}
      {canConfirm && selected.size > 0 && (
        <div className="card bulk-bar">
          <div className="bulk-count"><b>{fmtNum(selected.size)}</b> دفعة محددة</div>
          <button className="btn btn-primary" onClick={confirmBulk} disabled={busy}>
            {busy ? 'جارٍ التأكيد…' : '✓ تأكيد المحدد محاسبيًا'}
          </button>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد</button>
        </div>
      )}

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <strong>لا توجد دفعات</strong>
          {hasFilters ? 'جرّب تعديل الفلاتر' : 'سجّل أول تحصيل وسيحصل على رقم إيصال تلقائي'}
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table className="table sticky-head compact">
            <thead>
              <tr>
                {canConfirm && (
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allPageSelected}
                      disabled={!confirmable.length}
                      onChange={e => toggleAll(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                      title="تحديد غير المؤكدة في هذه الصفحة" />
                  </th>
                )}
                <th>الإيصال</th><th>العميل</th><th>الهاتف</th><th>السيلز</th><th>المنسقة</th>
                <th>المبلغ</th><th>الطريقة</th><th>التاريخ</th><th>سجّلتها</th>
                <th>التأكيد</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isVoid = p.status === 'void'
                const isVoidReq = p.status === 'void_requested'
                const canPick = p.status === 'active' && !p.confirmed_at
                return (
                  <tr key={p.id} style={isVoid ? { opacity: .5, textDecoration: 'line-through' } : {}}>
                    {canConfirm && (
                      <td>
                        {canPick && (
                          <input type="checkbox" checked={selected.has(p.id)}
                            onChange={() => toggleOne(p.id)}
                            style={{ width: 15, height: 15, cursor: 'pointer' }} />
                        )}
                      </td>
                    )}
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
                            ? <span className="badge badge-active">مؤكدة</span>
                            : canConfirm
                              ? <button className="btn btn-ghost btn-sm" onClick={() => confirm(p.id)}>تأكيد</button>
                              : <span className="badge badge-pending">بانتظار المحاسب</span>}
                    </td>
                    <td>
                      {p.status === 'active' && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={() => { setVoidingId(p.id); setVoidReason('') }}>
                          إلغاء
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          {total > PAGE && (
            <div className="pager">
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>← السابق</button>
              <span className="pager-info">
                صفحة {fmtNum(page + 1)} من {fmtNum(totalPages)} · {fmtNum(total)} دفعة
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>التالي →</button>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddPaymentModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); loadStats() }}
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
