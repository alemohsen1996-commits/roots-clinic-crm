// التحصيلات — سجل الدفعات + التأكيد المحاسبي + نظام إلغاء بموافقة
// المنسقة تطلب الإلغاء، المدير/المحاسب يوافق أو يرفض
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtNum, fmtDateTime, openWhatsApp } from '../lib/format'
import { exportCsv } from '../lib/exportCsv'
import { uploadReceipt, discardReceipt, openReceipt } from './receipts'
import AddPaymentModal from './AddPaymentModal'
import useT from '../i18n/useT'
import { useIsMobile } from '../lib/useIsMobile'
import ContactButtons from '../components/ContactButtons'
import { dbErr } from '../lib/dbErrors'

// تاريخ مختصر يمنع تكسّر الخلية في جدول متعدد الأعمدة
const shortDT = (d) => {
  if (!d) return '—'
  const x = new Date(d)
  return x.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })
       + ' · ' + x.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}

const METHODS = ['cash', 'mada', 'visa', 'mastercard', 'card', 'transfer', 'tabby', 'tamara', 'other']
// "كل الشبكة" في الفلتر = القديم + مدى + فيزا + ماستركارد
const CARD_METHODS = ['card', 'mada', 'visa', 'mastercard']

const STATUSES = ['active', 'void_requested', 'void']

const PAGE = 100
const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString().slice(0, 10)

const SELECT = `
  id, receipt_no, amount, method, paid_at, reference, notes, confirmed_at,
  status, void_reason, receipt_path, created_at,
  deals(id, total_amount, tax_amount, net_amount, status,
        leads(file_no, full_name, phone),
        agent:profiles!deals_agent_id_fkey(full_name),
        coordinator:profiles!deals_coordinator_id_fkey(full_name)),
  received:profiles!payments_received_by_fkey(full_name),
  confirmer:profiles!payments_confirmed_by_fkey(full_name),
  void_requester:profiles!payments_void_requested_by_fkey(full_name)
`

export default function PaymentsPage() {
  const { profile, isManager, roleCode } = useAuth()
  const { t } = useT()
  const SAR = t('common.currency')
  const methodLabel = (m) => t(`payMethod.${m}`, { defaultValue: m })
  const canConfirm = isManager || roleCode === 'accountant'
  const canApproveVoid = isManager || roleCode === 'accountant'
  const isMobile = useIsMobile()

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
  const [sortAsc, setSortAsc] = useState(false)          // ترتيب التاريخ: الأحدث أولًا افتراضيًا
  const [attachingId, setAttachingId] = useState(null)   // إرفاق إيصال لدفعة قديمة
  const [status, setStatus] = useState('')   // '' = الكل
  const [pendingVoids, setPendingVoids] = useState([])

  const [showAdd, setShowAdd] = useState(false)
  const [voidingId, setVoidingId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  const fromTs = from ? from + 'T00:00:00' : null
  const toTs = to ? to + 'T23:59:59' : null

  const applyFilters = useCallback((q) => {
    if (fromTs) q = q.gte('paid_at', fromTs)
    if (toTs)   q = q.lte('paid_at', toTs)
    if (method === 'card_all') q = q.in('method', CARD_METHODS)
    else if (method) q = q.eq('method', method)
    if (status) q = q.eq('status', status)
    if (onlyUnconfirmed) q = q.is('confirmed_at', null)
    if (search.trim()) q = q.ilike('receipt_no', `%${search.trim()}%`)
    return q
  }, [fromTs, toTs, method, status, onlyUnconfirmed, search])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    const q = applyFilters(
      supabase.from('payments').select(SELECT, { count: 'exact' })
        .order('paid_at', { ascending: sortAsc })
        .order('created_at', { ascending: sortAsc })
        .order('id', { ascending: sortAsc })
        .range(page * PAGE, page * PAGE + PAGE - 1)
    )

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
  }, [page, fromTs, toTs, method, applyFilters, sortAsc])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0); setSelected(new Set()) }, [fromTs, toTs, method, status, onlyUnconfirmed, search, sortAsc])

  // طلبات الإلغاء المعلّقة تُجلب مستقلة عن الفلاتر والصفحة — حتى لا تختفي عن المدير
  const loadPendingVoids = useCallback(async () => {
    if (!canApproveVoid) return
    const { data } = await supabase.from('payments').select(SELECT)
      .eq('status', 'void_requested').order('void_requested_at', { ascending: true })
    setPendingVoids(data ?? [])
  }, [canApproveVoid])
  useEffect(() => { loadPendingVoids() }, [loadPendingVoids])

  const loadStats = useCallback(async () => {
    const { data } = await supabase.rpc('payment_quick_stats')
    setStats(data ?? null)
  }, [])
  useEffect(() => { loadStats() }, [loadStats])

  // تحديث لحظي (Realtime): أي دفعة تُسجَّل/تُؤكَّد/تُلغى عند أي موظف تظهر فورًا
  // مع تجميع الأحداث المتتالية (مثل التأكيد الجماعي) في إعادة تحميل واحدة
  const refreshRef = useRef(() => {})
  useEffect(() => {
    refreshRef.current = () => { load({ silent: true }); loadStats(); loadPendingVoids() }
  })
  useEffect(() => {
    let timer = null
    const ch = supabase.channel('payments-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => refreshRef.current(), 400)
      })
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [])

  // ---------- الإجراءات ----------
  async function confirm(id) {
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { flash(t('payments.err.confirm') + ' — ' + dbErr(error.message)); return }
    flash(t('payments.confirmed'))
    load(); loadStats(); loadPendingVoids()
  }

  async function confirmBulk() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(t('payments.confirmBulkQ', { n: ids.length }))) return
    setBusy(true)
    const { error } = await supabase.from('payments').update({
      confirmed_by: profile.id, confirmed_at: new Date().toISOString(),
    }).in('id', ids)
    setBusy(false)
    if (error) { flash(t('payments.err.confirm') + ' — ' + dbErr(error.message)); return }
    flash(t('payments.confirmedN', { n: ids.length }))
    setSelected(new Set())
    load(); loadStats(); loadPendingVoids()
  }

  async function submitVoidRequest() {
    if (!voidReason.trim()) return
    const { error } = await supabase.rpc('request_payment_void', {
      p_payment_id: voidingId, p_reason: voidReason.trim(),
    })
    setVoidingId(null); setVoidReason('')
    if (error) { flash(t('payments.err.voidRequest')); return }
    flash(t('payments.voidRequested'))
    load(); loadStats(); loadPendingVoids()
  }

  async function approveVoid(id) {
    const { error } = await supabase.rpc('approve_payment_void', { p_payment_id: id })
    if (error) { flash(t('payments.err.approveVoid')); return }
    flash(t('payments.voided')); load(); loadStats(); loadPendingVoids()
  }

  async function rejectVoid(id) {
    const { error } = await supabase.rpc('reject_payment_void', { p_payment_id: id })
    if (error) { flash(t('payments.err.rejectVoid')); return }
    flash(t('payments.voidRejected')); load(); loadStats(); loadPendingVoids()
  }

  // إرفاق إيصال لدفعة قديمة مالهاش صورة (المحاسب/المدير)
  async function attachReceipt(p, file) {
    if (!file) return
    setAttachingId(p.id)
    let path
    try {
      path = await uploadReceipt(file, profile?.id)
    } catch (e) {
      setAttachingId(null); flash(dbErr(e.message)); return
    }
    const { error } = await supabase.from('payments').update({ receipt_path: path }).eq('id', p.id)
    setAttachingId(null)
    if (error) { discardReceipt(path); flash(t('payments.err.attach') + ' — ' + dbErr(error.message)); return }
    flash(t('payments.attached', { no: p.receipt_no })); load({ silent: true })
  }

  // ---------- التصدير ----------
  async function doExport() {
    setBusy(true)
    const all = []
    for (let off = 0; off < 20000; off += 1000) {
      const q = applyFilters(
        supabase.from('payments').select(SELECT)
          .order('paid_at', { ascending: sortAsc }).order('created_at', { ascending: sortAsc })
          .order('id', { ascending: sortAsc }).range(off, off + 999)
      )
      const { data, error } = await q
      if (error) { setBusy(false); flash(t('exportLeads.failed')); return }
      all.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    setBusy(false)

    const ST = (st) => t(`payments.st.${st}`, { defaultValue: st })
    exportCsv(
      `payments-${from || 'all'}-to-${to || 'now'}.csv`,
      t('payments.exportHeaders', { returnObjects: true }),
      all.map((p, i) => [
        i + 1, fmtDateTime(p.paid_at), p.receipt_no, p.deals?.leads?.full_name, p.deals?.leads?.file_no,
        p.deals?.leads?.phone, p.deals?.agent?.full_name, p.deals?.coordinator?.full_name,
        p.amount, p.deals?.tax_amount ?? '', p.deals?.net_amount ?? '', p.deals?.total_amount ?? '',
        methodLabel(p.method), p.reference ?? '',
        p.received?.full_name ?? '',
        ST(p.status), p.confirmed_at ? t('payments.confirmedBadge') : t('payments.unconfirmedBadge'),
        p.receipt_path ? t('payments.attachedBadge') : t('payments.notAttached'),
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE))
  const hasFilters = search || from || to || method || status || onlyUnconfirmed

  // كارت دفعة (موبايل)
  const paymentCard = (p) => {
    const isVoid = p.status === 'void'
    const isVoidReq = p.status === 'void_requested'
    const lead = p.deals?.leads
    return (
      <li key={p.id} className={'mcard' + (isVoid ? ' is-void' : '')}>
        <div className="mcard-main">
          <div className="mcard-top">
            <span className="mcard-title">{lead?.full_name}<small>{lead?.file_no}</small></span>
            <span className="mcard-amount">{fmtNum(p.amount)} {SAR}</span>
          </div>
          <div className="mcard-sub">
            {shortDT(p.paid_at)} · {methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ''}
          </div>
          <div className="mcard-meta">
            <span dir="ltr">{p.receipt_no}</span>
            <span>{t('rolesShort.agent')}: {p.deals?.agent?.full_name ?? '—'}</span>
            <span>{t('lead.coordShort')}: {p.deals?.coordinator?.full_name ?? '—'}</span>
            <span>{t('payments.recordedBy')}: {p.received?.full_name ?? '—'}</span>
          </div>
          <div className="mcard-meta">
            {isVoid
              ? <span className="badge badge-suspended">{t('payments.st.void')}</span>
              : isVoidReq
                ? <span className="badge badge-pending">{t('payments.st.void_requested')}</span>
                : p.confirmed_at
                  ? <span className="badge badge-active">{t('payments.confirmedBadge')}</span>
                  : <span className="badge badge-pending">{t('payments.awaitingAccountant')}</span>}
          </div>
        </div>
        <div className="mcard-actions">
          <ContactButtons phone={lead?.phone} />
          {p.receipt_path ? (
            <button type="button" className="mact" title={t('payments.viewReceipt')} aria-label={t('payments.viewReceipt')}
              onClick={() => openReceipt(p.receipt_path)}>📎</button>
          ) : canConfirm && !isVoid ? (
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }} title={t('payments.attachHint')}>
              {attachingId === p.id ? '…' : t('payments.attach')}
              <input type="file" accept="image/*,application/pdf" hidden
                disabled={attachingId === p.id}
                onChange={e => { attachReceipt(p, e.target.files?.[0]); e.target.value = '' }} />
            </label>
          ) : null}
          {canConfirm && p.status === 'active' && !p.confirmed_at && (
            <button type="button" className="btn btn-primary grow" onClick={() => confirm(p.id)}>{t('common.confirm')}</button>
          )}
          {p.status === 'active' && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
              onClick={() => { setVoidingId(p.id); setVoidReason('') }}>
              {t('payments.void')}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.payments')}</h1>
          <div className="hint">
            {sums
              ? t('payments.activeSummary', { n: fmtNum(sums.active_count), total: fmtNum(sums.active_total), cur: SAR })
              : '—'}
            {hasFilters && <span style={{ color: 'var(--gold)' }}> ({t('payments.withinFilters')})</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canConfirm && (
            <button className="btn btn-ghost" onClick={doExport} disabled={busy || !total}>
              {busy ? '…' : `⬇ ${t('payments.export')}`}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ {t('payment.title')}</button>
        </div>
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* كروت الملخص */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
          {[
            { label: t('payments.todayCollections'), value: fmtNum(stats.today) + ' ' + SAR,
              sub: t('payments.nPayments', { n: fmtNum(stats.today_count) }), gold: true },
            { label: t('payments.monthCollections'), value: fmtNum(stats.month) + ' ' + SAR,
              sub: t('payments.nPayments', { n: fmtNum(stats.month_count) }), gold: true },
            { label: t('payments.awaitingConfirm'), value: fmtNum(stats.unconfirmed),
              sub: fmtNum(stats.unconfirmed_total) + ' ' + SAR,
              warn: stats.unconfirmed > 0,
              onClick: () => { setOnlyUnconfirmed(true); setFrom(''); setTo('') } },
            { label: t('payments.netMonth'), value: fmtNum(stats.net_month) + ' ' + SAR,
              sub: t('payments.netMonthSub', { n: fmtNum(stats.net_month_count), tax: fmtNum(stats.tax_month), cur: SAR }),
              gold: true },
            { label: t('payments.voidRequests'), value: fmtNum(stats.void_pending),
              sub: stats.void_pending > 0 ? t('payments.needsDecision') : t('common.none'),
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
            <h2 style={{ fontSize: 15, color: 'var(--warn)' }}>{t('payments.pendingVoids')}</h2>
            <span className="badge badge-pending">{pendingVoids.length}</span>
          </div>
          {isMobile ? (
            <ul className="mcards" style={{ padding: 12 }}>
              {pendingVoids.map(p => (
                <li key={p.id} className="mcard">
                  <div className="mcard-main">
                    <div className="mcard-top">
                      <span className="mcard-title">{p.deals?.leads?.full_name}<small dir="ltr">{p.receipt_no}</small></span>
                      <span className="mcard-amount">{fmtNum(p.amount)} {SAR}</span>
                    </div>
                    {p.void_reason && <div className="mcard-note">{p.void_reason}</div>}
                    <div className="mcard-meta"><span>{t('payments.requestedBy')}: {p.void_requester?.full_name ?? '—'}</span></div>
                  </div>
                  <div className="mcard-actions">
                    {p.receipt_path && (
                      <button type="button" className="mact" title={t('payments.viewReceipt')} aria-label={t('payments.viewReceipt')}
                        onClick={() => openReceipt(p.receipt_path)}>📎</button>
                    )}
                    <button type="button" className="btn btn-danger grow" onClick={() => approveVoid(p.id)}>{t('payments.approve')}</button>
                    <button type="button" className="btn btn-ghost grow" onClick={() => rejectVoid(p.id)}>{t('payments.reject')}</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
          <table className="table compact" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{t('payments.receipt')}</th><th>{t('lead.client')}</th><th>{t('payment.amount')}</th><th>{t('payments.voidReason')}</th><th>{t('payments.requestedBy')}</th><th>{t('payments.image')}</th><th></th></tr>
            </thead>
            <tbody>
              {pendingVoids.map(p => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.receipt_no}</td>
                  <td>{p.deals?.leads?.full_name}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {fmtNum(p.amount)} {SAR}
                  </td>
                  <td>{p.void_reason}</td>
                  <td>{p.void_requester?.full_name ?? '—'}</td>
                  <td>
                    {p.receipt_path
                      ? <button className="icon-btn" title={t('payments.viewReceipt')} onClick={() => openReceipt(p.receipt_path)}>📎</button>
                      : <span style={{ color: 'var(--ink-soft)' }}>—</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" onClick={() => approveVoid(p.id)}>{t('payments.approve')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rejectVoid(p.id)}>{t('payments.reject')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      )}

      {/* الفلاتر */}
      <div className="card filters-bar">
        <input className="filter-search" placeholder={t('payments.searchPh')}
          value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('drawer.from')}</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('leads.f.to')}</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={method} onChange={e => setMethod(e.target.value)}>
          <option value="">{t('payments.allMethods')}</option>
          <option value="card_all">{t('payments.allCards')}</option>
          {METHODS.map(k => <option key={k} value={k}>{methodLabel(k)}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t('payments.allStatuses')}</option>
          {STATUSES.map(k => <option key={k} value={k}>{t(`payments.stFilter.${k}`)}</option>)}
        </select>
        <button className={'chip' + (status === 'void' ? ' on' : '')}
          onClick={() => setStatus(v => v === 'void' ? '' : 'void')}>
          {t('payments.stFilter.void')}
        </button>
        <button className={'chip' + (onlyUnconfirmed ? ' on' : '')}
          onClick={() => setOnlyUnconfirmed(v => !v)}>
          {t('payments.unconfirmedFilter')}
        </button>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setFrom(today()); setTo(today()) }}>{t('task.quick.today')}</button>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setFrom(monthStart()); setTo(today()) }}>{t('payments.thisMonth')}</button>
        {hasFilters && (
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setSearch(''); setFrom(''); setTo(''); setMethod(''); setStatus(''); setOnlyUnconfirmed(false) }}>
            {t('deals.clearFilters')}
          </button>
        )}
      </div>

      {/* شريط التأكيد الجماعي */}
      {canConfirm && selected.size > 0 && (
        <div className="card bulk-bar">
          <div className="bulk-count"><b>{fmtNum(selected.size)}</b> {t('payments.selected')}</div>
          <button className="btn btn-primary" onClick={confirmBulk} disabled={busy}>
            {busy ? t('payments.confirming') : `✓ ${t('payments.confirmSelected')}`}
          </button>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>{t('bulk.clearSelection')}</button>
        </div>
      )}

      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="card empty">
          <strong>{t('payments.noPayments')}</strong>
          {hasFilters ? t('leads.noResultsBody') : t('payments.noPaymentsHint')}
        </div>
      ) : (
        <div className="card">
          {isMobile ? (
            <ul className="mcards" style={{ padding: 12 }}>{rows.map(paymentCard)}</ul>
          ) : (
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
                      title={t('payments.selectUnconfirmedPage')} />
                  </th>
                )}
                <th style={{ width: 40 }}>#</th>
                <th aria-sort={sortAsc ? 'ascending' : 'descending'}>
                  <button type="button" className="th-sort on" onClick={() => setSortAsc(v => !v)}
                    title={sortAsc ? t('payments.sortOldest') : t('payments.sortNewest')}>
                    {t('payments.date')} {sortAsc ? '↑' : '↓'}
                  </button>
                </th>
                <th>{t('lead.client')}</th><th>{t('payments.receipt')}</th><th>{t('lead.phone')}</th><th>{t('rolesShort.agent')}</th><th>{t('lead.coordShort')}</th>
                <th>{t('payment.amount')}</th><th>{t('deal.tax')}</th><th>{t('payments.opNet')}</th>
                <th>{t('payments.method')}</th><th>{t('payments.recordedBy')}</th>
                <th>{t('payments.confirmation')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
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
                    <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{page * PAGE + i + 1}</td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={fmtDateTime(p.paid_at)}>
                      {shortDT(p.paid_at)}
                    </td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {p.deals?.leads?.full_name}
                      <small style={{ color: 'var(--ink-soft)', display: 'block', fontWeight: 400 }}>
                        {p.deals?.leads?.file_no}
                      </small>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {p.receipt_no}
                        {p.receipt_path ? (
                          <button className="icon-btn" title={t('payments.viewReceipt')} aria-label={t('payments.viewReceipt')}
                            onClick={() => openReceipt(p.receipt_path)}>📎</button>
                        ) : canConfirm && !isVoid ? (
                          <label className="btn btn-ghost btn-sm" style={{ fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                            title={t('payments.attachHint')}>
                            {attachingId === p.id ? '…' : t('payments.attach')}
                            <input type="file" accept="image/*,application/pdf" hidden
                              disabled={attachingId === p.id}
                              onChange={e => { attachReceipt(p, e.target.files?.[0]); e.target.value = '' }} />
                          </label>
                        ) : (
                          <span title={t('payments.noReceipt')} style={{ color: 'var(--ink-soft)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="phone-cell">
                        <span dir="ltr">{p.deals?.leads?.phone ?? '—'}</span>
                        {p.deals?.leads?.phone && (
                          <>
                            <a className="icon-btn" href={`tel:${p.deals.leads.phone}`} title={t('lead.call')}>☎</a>
                            <button className="icon-btn" title="WhatsApp"
                            onClick={() => openWhatsApp(p.deals.leads.phone)}>
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                              </svg>
                            </button>
                            <button className="icon-btn" title={t('lead.copyPhone')}
                              onClick={() => navigator.clipboard?.writeText(p.deals.leads.phone)}>⧉</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{p.deals?.agent?.full_name ?? '—'}</td>
                    <td style={{ fontSize: 12.5 }}>{p.deals?.coordinator?.full_name ?? '—'}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fmtNum(p.amount)} {SAR}
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: 'var(--ink-soft)' }}>
                      {Number(p.deals?.tax_amount) > 0 ? fmtNum(p.deals.tax_amount) + ' ' + SAR : '—'}
                    </td>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: 600 }}
                      title={t('payments.opNetHint')}>
                      {p.deals?.net_amount ? fmtNum(p.deals.net_amount) + ' ' + SAR : '—'}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {methodLabel(p.method)}
                      {p.reference && <small style={{ color: 'var(--ink-soft)', display: 'block' }}>{p.reference}</small>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{p.received?.full_name ?? '—'}</td>
                    <td>
                      {isVoid
                        ? <span className="badge badge-suspended">{t('payments.st.void')}</span>
                        : isVoidReq
                          ? <span className="badge badge-pending">{t('payments.st.void_requested')}</span>
                          : p.confirmed_at
                            ? <span className="badge badge-active">{t('payments.confirmedBadge')}</span>
                            : canConfirm
                              ? <button className="btn btn-ghost btn-sm" onClick={() => confirm(p.id)}>{t('common.confirm')}</button>
                              : <span className="badge badge-pending">{t('payments.awaitingAccountant')}</span>}
                    </td>
                    <td>
                      {p.status === 'active' && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={() => { setVoidingId(p.id); setVoidReason('') }}>
                          {t('payments.void')}
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

          {total > PAGE && (
            <div className="pager">
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>{t('common.prev')}</button>
              <span className="pager-info">
                {t('common.pageOf', { page: fmtNum(page + 1), total: fmtNum(totalPages) })} · {t('payments.nPayments', { n: fmtNum(total) })}
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddPaymentModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); loadStats(); loadPendingVoids() }}
        />
      )}

      {/* نافذة سبب الإلغاء */}
      {voidingId && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setVoidingId(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2>{t('payments.voidTitle')}</h2>
            <p className="sub">{t('payments.voidSub')}</p>
            <div className="field">
              <label>{t('payments.voidReason')}</label>
              <input value={voidReason} onChange={e => setVoidReason(e.target.value)}
                placeholder={t('payments.voidPh')}
                onKeyDown={e => e.key === 'Enter' && submitVoidRequest()} autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={submitVoidRequest} disabled={!voidReason.trim()}>
                {t('payments.sendRequest')}
              </button>
              <button className="btn btn-ghost" onClick={() => setVoidingId(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
