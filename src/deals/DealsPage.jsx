// صفحة الديلات — كروت أرقام (فلاتر سريعة) + تبويبات الحالة + فترة على تاريخ العملية
// + جدول بأعمدة مدموجة وقابل للترتيب، وعمود تحصيل وتنبيهات
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { salesLabel } from '../lib/people'
import {
  useDealRefs, fetchDeals, fetchAllDeals, fetchDealsOverview, DEAL_STATUS, DEAL_SORTS,
} from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'
import NewDealModal from './NewDealModal'
import DealDrawer from './DealDrawer'

const TABS = [
  { id: '',        label: 'الكل' },
  { id: 'active',  label: 'الجاية' },
  { id: 'waiting', label: 'انتظار' },
  { id: 'done',    label: 'تمت' },
  { id: 'lost',    label: 'خسارة' },
]

const QUICK_LABEL = { overdue: 'متأخرة عن تاريخها', remaining: 'عليها متبقي تحصيل' }

// تواريخ بتوقيت الرياض بصيغة YYYY-MM-DD
const riyadhToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
function monthRange(offset) {
  const [y, m] = riyadhToday().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  const iso = (x) => x.toISOString().slice(0, 10)
  return { from: iso(d), to: iso(last) }
}
const monthName = (offset) => {
  const { from } = monthRange(offset)
  return new Date(from + 'T12:00:00Z').toLocaleDateString('ar', { month: 'long', timeZone: 'UTC' })
}
function daysFromToday(date) {
  if (!date) return null
  return Math.round((new Date(date + 'T00:00:00Z') - new Date(riyadhToday() + 'T00:00:00Z')) / 86400000)
}

// تنبيهات الصف
function dealFlags(d) {
  const flags = []
  if (d.is_overdue) flags.push({ label: 'التاريخ عدّى ولسه مفتوحة', tone: 'danger' })
  if (!d.coordinator_id && !['lost', 'cancelled'].includes(d.status)) flags.push({ label: 'بدون منسقة', tone: 'danger' })
  if (d.status === 'done' && Number(d.open_remaining) > 0) flags.push({ label: 'متبقي تحصيل', tone: 'warn' })
  if (['active', 'waiting'].includes(d.status) && !d.operation_date) flags.push({ label: 'بدون تاريخ عملية', tone: 'muted' })
  return flags
}

export default function DealsPage() {
  const { profile, roleCode } = useAuth()
  const isAgent = roleCode === 'agent'   // موظف المبيعات: مايشوفش فلتر موظفي المبيعات
  const refs = useDealRefs()
  const [params, setParams] = useSearchParams()

  const [deals, setDeals] = useState([])
  const [total, setTotal] = useState(0)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState([])

  const [status, setStatus] = useState('')
  const [quick, setQuick] = useState('')          // overdue | remaining
  const [period, setPeriod] = useState('all')     // all | this | last | custom
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [branch, setBranch] = useState('')
  const [agentId, setAgentId] = useState('')
  const [coordId, setCoordId] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const [showNew, setShowNew] = useState(false)
  const [openDeal, setOpenDeal] = useState(null)
  const [copied, setCopied] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  // الفترة على تاريخ العملية
  const range = useMemo(() => {
    if (period === 'this') return monthRange(0)
    if (period === 'last') return monthRange(-1)
    if (period === 'custom') return { from, to }
    return { from: '', to: '' }
  }, [period, from, to])

  // فلاتر الكروت/التبويبات (من غير الحالة والفلتر السريع)
  const baseFilters = useMemo(() => ({
    from: range.from, to: range.to, branch, coordinator: coordId, search: debounced,
    agent: isAgent ? '' : agentId,
  }), [range, branch, coordId, debounced, agentId, isAgent])

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    const [{ rows, total }, ov] = await Promise.all([
      fetchDeals({ ...baseFilters, status, quick, sort: sort.key, dir: sort.dir, page, pageSize }),
      fetchDealsOverview(baseFilters),
    ])
    setDeals(rows)
    setTotal(total)
    setOverview(ov)
    setLoading(false)
  }, [baseFilters, status, quick, sort, page, pageSize])

  useEffect(() => { load() }, [load])
  const reloadQuiet = useCallback(() => load({ quiet: true }), [load])
  useEffect(() => { setPage(0) }, [baseFilters, status, quick, sort, pageSize])

  // لو جاي من شاشة الليدات بعد نقل ليد للديل: ?lead=ID يفتح نموذج التعاقد جاهزًا
  const preloadLead = params.get('lead')
  useEffect(() => { if (preloadLead) setShowNew(true) }, [preloadLead])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = status || quick || period !== 'all' || branch || agentId || coordId || search

  function clearAll() {
    setStatus(''); setQuick(''); setPeriod('all'); setFrom(''); setTo('')
    setBranch(''); setAgentId(''); setCoordId(''); setSearch('')
  }

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })
  }
  const sortArrow = (key) => sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'

  function copyPhone(e, phone) {
    e.stopPropagation()
    navigator.clipboard?.writeText(phone)
    setCopied(phone)
    setTimeout(() => setCopied(c => (c === phone ? null : c)), 1500)
  }

  async function doExport() {
    setExporting(true)
    try {
      const all = await fetchAllDeals({ ...baseFilters, status, quick, sort: sort.key, dir: sort.dir })
      const head = ['رقم الملف', 'العميل', 'الهاتف', 'الفرع', 'رقم العملية', 'النوع', 'التقنية', 'البصيلات',
        'السيلز', 'المنسقة', 'تاريخ العملية', 'الحالة', 'الصافي', 'الضريبة', 'الإجمالي', 'المحصّل', 'المتبقي']
      const lines = all.map(d => [
        d.file_no, d.full_name, d.phone ?? '', d.branch_name ?? '', d.procedure_no,
        d.procedure_name ?? '', d.technique_name ?? '', d.grafts ?? '',
        d.agent_name ?? '', d.coordinator_name ?? '', d.operation_date ?? '',
        DEAL_STATUS[d.status]?.label ?? d.status,
        d.net_amount, d.tax_amount ?? 0, d.total_amount, d.collected, d.open_remaining,
      ])
      const csv = [head, ...lines]
        .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n')
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `deals-${riyadhToday()}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      console.error(err)
    }
    setExporting(false)
  }

  const ov = overview ?? {}
  const kpis = [
    { id: 'done', label: 'ديلات تمت', value: fmtNum(ov.done_count),
      sub: `صافي ${fmtNum(ov.done_net)} ر.س`, tone: 'ok',
      on: status === 'done' && !quick,
      pick: () => { setQuick(''); setStatus(s => (s === 'done' ? '' : 'done')) } },
    { id: 'remaining', label: 'متبقي تحصيله', value: `${fmtNum(ov.rem_sum)} ر.س`,
      sub: `على ${fmtNum(ov.rem_count)} ديل`, tone: 'warn',
      on: quick === 'remaining',
      pick: () => { setStatus(''); setQuick(q => (q === 'remaining' ? '' : 'remaining')) } },
    { id: 'overdue', label: 'متأخرة عن تاريخها', value: fmtNum(ov.overdue_count),
      sub: 'تاريخ العملية عدّى ولسه مفتوحة', tone: ov.overdue_count > 0 ? 'danger' : 'muted',
      on: quick === 'overdue',
      pick: () => { setStatus(''); setQuick(q => (q === 'overdue' ? '' : 'overdue')) } },
    { id: 'waiting', label: 'قائمة الانتظار', value: fmtNum(ov.waiting_count),
      sub: `صافي ${fmtNum(ov.waiting_net)} ر.س`, tone: 'primary',
      on: status === 'waiting' && !quick,
      pick: () => { setQuick(''); setStatus(s => (s === 'waiting' ? '' : 'waiting')) } },
  ]
  const tabCount = (id) => (id ? ov.by_status?.[id] ?? 0 : ov.total ?? 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الديلات</h1>
          <div className="hint">
            {fmtNum(total)} تعاقد · مرتبة حسب {DEAL_SORTS[sort.key].label}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={doExport} disabled={exporting || !total}>
            {exporting ? 'جارٍ التصدير…' : '⬇ تصدير CSV'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ ديل جديد</button>
        </div>
      </div>

      {/* كروت الأرقام — كل كارت فلتر بضغطة */}
      <div className="deals-kpis">
        {kpis.map(k => (
          <button key={k.id} type="button" className={'deals-kpi' + (k.on ? ' on' : '')}
            aria-pressed={k.on} onClick={k.pick}>
            <span className="deals-kpi-head">
              <span>{k.label}</span>
              <span className={'deals-dot tone-' + k.tone} />
            </span>
            <span className={'deals-kpi-value tone-' + k.tone}>{overview ? k.value : '—'}</span>
            <span className="deals-kpi-sub">{overview ? k.sub : ' '}</span>
          </button>
        ))}
      </div>

      <div className="card deals-toolbar">
        <div className="deals-toolbar-row">
          <div className="deals-tabs" role="tablist" aria-label="حالة الديل">
            {TABS.map(t => {
              const on = status === t.id && !quick
              return (
                <button key={t.id || 'all'} type="button" role="tab" aria-selected={on}
                  className={'deals-tab' + (on ? ' on' : '')}
                  onClick={() => { setQuick(''); setStatus(t.id) }}>
                  {t.label}
                  <span className="deals-tab-count">{fmtNum(tabCount(t.id))}</span>
                </button>
              )
            })}
          </div>

          <div className="deals-period">
            <span>تاريخ العملية:</span>
            {[
              { id: 'this', label: monthName(0) },
              { id: 'last', label: monthName(-1) },
              { id: 'custom', label: 'مخصص' },
              { id: 'all', label: 'الكل' },
            ].map(p => (
              <button key={p.id} type="button" aria-pressed={period === p.id}
                className={'chip' + (period === p.id ? ' on' : '')}
                onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <>
                <input type="date" aria-label="من" value={from} onChange={e => setFrom(e.target.value)} />
                <input type="date" aria-label="إلى" value={to} onChange={e => setTo(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="filters-bar deals-filters">
          <input className="filter-search" placeholder="بحث بالاسم أو الهاتف أو رقم الملف…"
            aria-label="بحث" value={search} onChange={e => setSearch(e.target.value)} />

          <select aria-label="الفرع" value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {!isAgent && (
            <select aria-label="موظف المبيعات" value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">كل موظفي المبيعات</option>
              {(refs.agents ?? []).some(a => a.id === profile?.id) && <option value={profile.id}>ديلاتي</option>}
              {(refs.agents ?? []).filter(a => a.id !== profile?.id)
                .map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
            </select>
          )}

          <select aria-label="المنسقة" value={coordId} onChange={e => setCoordId(e.target.value)}>
            <option value="">كل المنسقات</option>
            {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>

          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>مسح الفلاتر</button>
          )}
        </div>

        {quick && (
          <div className="deals-quick">
            <span>فلتر سريع:</span>
            <button type="button" className="chip on" onClick={() => setQuick('')}
              aria-label={`إلغاء فلتر ${QUICK_LABEL[quick]}`}>
              {QUICK_LABEL[quick]} ✕
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : deals.length === 0 ? (
        <div className="card empty">
          <strong>{hasFilters ? 'مفيش ديلات مطابقة للفلاتر دي' : 'لا توجد ديلات'}</strong>
          {hasFilters
            ? <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={clearAll}>مسح الفلاتر</button>
            : 'انقل عميلًا إلى مرحلة الديل ثم افتح له ملف تعاقد من هنا'}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="table deals-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>البيع</th>
                <th>الفريق</th>
                <th aria-sort={sort.key === 'date' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'date' ? ' on' : '')}
                    onClick={() => toggleSort('date')}>تاريخ العملية {sortArrow('date')}</button>
                </th>
                <th aria-sort={sort.key === 'net' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'net' ? ' on' : '')}
                    onClick={() => toggleSort('net')}>الصافي {sortArrow('net')}</button>
                </th>
                <th style={{ minWidth: 190 }}
                  aria-sort={sort.key === 'remaining' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'remaining' ? ' on' : '')}
                    onClick={() => toggleSort('remaining')}>التحصيل {sortArrow('remaining')}</button>
                </th>
                <th>الحالة</th>
                <th>تنبيهات</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(d => {
                const st = DEAL_STATUS[d.status]
                const closed = ['lost', 'cancelled'].includes(d.status)
                const due = Number(d.total_amount) || 0
                const collected = Number(d.collected) || 0
                const rem = Number(d.open_remaining) || 0
                const pct = due > 0 ? Math.min(100, Math.round((collected / due) * 100)) : 0
                const days = daysFromToday(d.operation_date)
                const rel = days == null ? 'لم يُحدد'
                  : days === 0 ? 'النهارده'
                  : days > 0 ? `بعد ${fmtNum(days)} يوم` : `من ${fmtNum(-days)} يوم`
                const flags = dealFlags(d)
                return (
                  <tr key={d.id} onClick={() => setOpenDeal(d)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="deals-name">{d.full_name ?? '—'}</div>
                      {d.phone && (
                        <div className="phone-cell deals-sub">
                          <span>{d.phone}</span>
                          <button type="button" className="icon-btn"
                            title={copied === d.phone ? 'اتنسخ' : 'نسخ الرقم'}
                            aria-label="نسخ الرقم"
                            onClick={e => copyPhone(e, d.phone)}>
                            {copied === d.phone ? '✓' : '⧉'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{d.procedure_name ?? '—'}</span>
                        {d.procedure_kind !== 'surgery' && (
                          <span className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                            {d.procedure_kind === 'product' ? 'منتج' : 'جلسات علاج'}
                          </span>
                        )}
                        {d.procedure_kind === 'surgery' && d.procedure_no > 1 && (
                          <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                            عملية {d.procedure_no}
                          </span>
                        )}
                      </div>
                      <div className="deals-sub">
                        {[d.technique_name, d.grafts ? `${fmtNum(d.grafts)} بصيلة` : null, d.branch_name]
                          .filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div><span className="deals-muted">سيلز:</span> {d.agent_name ?? '—'}</div>
                      <div style={{ marginTop: 3 }}>
                        <span className="deals-muted">منسقة:</span>{' '}
                        {d.coordinator_name ?? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>لم تُحدد</span>}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{d.operation_date ? fmtDate(d.operation_date) : '—'}</div>
                      <div className="deals-sub">{rel}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{fmtNum(d.net_amount)} ر.س</td>
                    <td>
                      {closed ? (
                        <span className="deals-muted">—</span>
                      ) : (
                        <>
                          <div className="deals-bar" role="img"
                            aria-label={`محصّل ${pct}% من المستحق`}>
                            <span className={rem > 0 ? 'part' : 'full'} style={{ width: pct + '%' }} />
                          </div>
                          <div className="deals-bar-meta">
                            <span className="deals-muted">{fmtNum(collected)} محصّل</span>
                            {rem > 0
                              ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>متبقي {fmtNum(rem)}</span>
                              : <span style={{ color: 'var(--ok)', fontWeight: 700 }}>مدفوع بالكامل</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={'badge ' + (st?.cls ?? '')}>{st?.label ?? d.status}</span>
                      {d.is_locked && ' 🔒'}
                    </td>
                    <td>
                      <div className="deals-flags">
                        {flags.map(f => (
                          <span key={f.label} className={'deals-flag tone-' + f.tone}>{f.label}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="pager">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>لكل صفحة:</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ width: 80 }}>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          {total > pageSize && (
            <>
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>← السابق</button>
              <span className="pager-info">
                صفحة {fmtNum(page + 1)} من {fmtNum(totalPages)}
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>التالي →</button>
            </>
          )}
        </div>
      )}

      {showNew && (
        <NewDealModal
          refs={refs}
          preloadLeadId={preloadLead}
          onClose={() => { setShowNew(false); if (preloadLead) setParams({}) }}
          onSaved={() => { setShowNew(false); if (preloadLead) setParams({}); reloadQuiet() }}
        />
      )}

      {openDeal && (
        <DealDrawer
          dealId={openDeal.id}
          refs={refs}
          siblings={deals}
          onNavigate={setOpenDeal}
          onClose={() => setOpenDeal(null)}
          onChanged={reloadQuiet}
        />
      )}
    </>
  )
}
