// صفحة الديلات — كروت أرقام (فلاتر سريعة) + تبويبات الحالة + فترة على تاريخ العملية
// + جدول بأعمدة مدموجة وقابل للترتيب، وعمود تحصيل وتنبيهات
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { salesLabel } from '../lib/people'
import {
  useDealRefs, fetchDeals, fetchAllDeals, fetchDealsOverview, DEAL_STATUS, DEAL_SORTS, kindLabel,
} from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'
import i18n from '../i18n'
import useT from '../i18n/useT'
import NewDealModal from './NewDealModal'
import DealDrawer from './DealDrawer'
import { useIsMobile } from '../lib/useIsMobile'
import ContactButtons from '../components/ContactButtons'

// التبويبات والأنواع — العناوين من deals.tabs.* / kind.*
const TABS = ['', 'active', 'waiting', 'done', 'lost']
const KINDS = ['', 'surgery', 'treatment', 'product']

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
  return new Date(from + 'T12:00:00Z').toLocaleDateString(i18n.language === 'en' ? 'en' : 'ar', { month: 'long', timeZone: 'UTC' })
}
function daysFromToday(date) {
  if (!date) return null
  return Math.round((new Date(date + 'T00:00:00Z') - new Date(riyadhToday() + 'T00:00:00Z')) / 86400000)
}

// تنبيهات الصف
function dealFlags(d, t) {
  const flags = []
  if (d.is_overdue) flags.push({ label: t('deals.flags.overdue'), tone: 'danger' })
  if (!d.coordinator_id && !['lost', 'cancelled'].includes(d.status)) flags.push({ label: t('deals.flags.noCoord'), tone: 'danger' })
  if (d.status === 'done' && Number(d.open_remaining) > 0) flags.push({ label: t('deals.flags.remaining'), tone: 'warn' })
  if (['active', 'waiting'].includes(d.status) && !d.operation_date) flags.push({ label: t('deals.flags.noDate'), tone: 'muted' })
  return flags
}

// كارت ديل (موبايل) — نفس معلومات صف الجدول، مرتّبة للقراءة من فوق لتحت
function DealCard({ d, onOpen }) {
  const { t, dn } = useT()
  const SAR = t('common.currency')
  const st = DEAL_STATUS[d.status]
  const closed = ['lost', 'cancelled'].includes(d.status)
  const due = Number(d.total_amount) || 0
  const collected = Number(d.collected) || 0
  const rem = Number(d.open_remaining) || 0
  const pct = due > 0 ? Math.min(100, Math.round((collected / due) * 100)) : 0
  const days = daysFromToday(d.operation_date)
  const rel = days == null ? t('deals.notSet')
    : days === 0 ? t('deals.today')
    : days > 0 ? t('deals.inDays', { n: fmtNum(days) }) : t('deals.daysAgo', { n: fmtNum(-days) })
  const flags = dealFlags(d, t)
  const sale = dn({ name_ar: d.procedure_name, name_en: d.procedure_name_en }) || '—'
  const details = [d.technique_name, d.grafts ? `${fmtNum(d.grafts)} ${t('deals.graftUnit')}` : null,
    dn({ name: d.branch_name, name_en: d.branch_name_en })].filter(Boolean).join(' · ')

  return (
    <li className={'mcard' + (flags.some(f => f.tone === 'danger') ? ' tone-danger' : '')}>
      <button type="button" className="mcard-main" onClick={onOpen}>
        <div className="mcard-top">
          <span className="mcard-title">{d.full_name ?? '—'}<small>{sale}{details ? ` · ${details}` : ''}</small></span>
          <span className={'badge ' + (st?.cls ?? '')}>{st ? t(st.label) : d.status}{d.is_locked && ' 🔒'}</span>
        </div>
        <div className="mcard-row">
          <span>{d.operation_date ? fmtDate(d.operation_date) : '—'} <span className="deals-muted">· {rel}</span></span>
          <b>{fmtNum(d.net_amount)} {SAR}</b>
        </div>
        {!closed && due > 0 && (
          <>
            <div className="deals-bar" role="img" aria-label={t('deals.collectedPct', { pct })}>
              <span className={rem > 0 ? 'part' : 'full'} style={{ width: pct + '%' }} />
            </div>
            <div className="deals-bar-meta">
              <span className="deals-muted">{fmtNum(collected)} {t('common.collected')}</span>
              {rem > 0
                ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('deals.sorts.remaining')} {fmtNum(rem)}</span>
                : <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{t('payStatus.paid')}</span>}
            </div>
          </>
        )}
        <div className="mcard-meta">
          <span>{t('rolesShort.agent')}: {d.agent_name ?? '—'}</span>
          <span>{t('lead.coordShort')}: {d.coordinator_name ?? t('deals.notSet')}</span>
        </div>
        {flags.length > 0 && (
          <div className="deals-flags">
            {flags.map(f => <span key={f.label} className={'deals-flag tone-' + f.tone}>{f.label}</span>)}
          </div>
        )}
      </button>
      {d.phone && (
        <div className="mcard-actions">
          <ContactButtons phone={d.phone} />
          <span className="hint" dir="ltr">{d.phone}</span>
        </div>
      )}
    </li>
  )
}

export default function DealsPage() {
  const { profile, roleCode } = useAuth()
  const { t, dn } = useT()
  const SAR = t('common.currency')
  const isMobile = useIsMobile()
  const isAgent = roleCode === 'agent'   // موظف المبيعات: مايشوفش فلتر موظفي المبيعات
  const refs = useDealRefs()
  const [params, setParams] = useSearchParams()

  const [deals, setDeals] = useState([])
  const [total, setTotal] = useState(0)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState([])

  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')            // '' | surgery | treatment | product
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
    supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name')
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
    agent: isAgent ? '' : agentId, kind,
  }), [range, branch, coordId, debounced, agentId, isAgent, kind])

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
  const hasFilters = status || quick || kind || period !== 'all' || branch || agentId || coordId || search

  function clearAll() {
    setStatus(''); setQuick(''); setKind(''); setPeriod('all'); setFrom(''); setTo('')
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
      const head = t('deals.exportHeaders', { returnObjects: true })
      const lines = all.map(d => [
        d.file_no, d.full_name, d.phone ?? '', dn({ name: d.branch_name, name_en: d.branch_name_en }), d.procedure_no,
        kindLabel(d.procedure_kind), dn({ name_ar: d.procedure_name, name_en: d.procedure_name_en }), d.technique_name ?? '', d.grafts ?? '',
        d.agent_name ?? '', d.coordinator_name ?? '', d.operation_date ?? '',
        DEAL_STATUS[d.status] ? t(DEAL_STATUS[d.status].label) : d.status,
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
  // سطر تقسيم المتممة حسب النوع (لما مفيش فلتر نوع)
  const doneSplit = ['surgery', 'treatment', 'product']
    .filter(k => Number(ov.done_by_kind?.[k] ?? 0) > 0)
    .map(k => `${fmtNum(ov.done_by_kind[k])} ${t(`deals.unit.${k}`)}`)
    .join(' · ')
  const kpis = [
    { id: 'done', label: kind ? t('deals.kpi.kindDone', { kind: kindLabel(kind) }) : t('deals.kpi.done'), value: fmtNum(ov.done_count),
      sub: !kind && doneSplit ? doneSplit : t('deals.kpi.netOf', { n: fmtNum(ov.done_net), cur: SAR }), tone: 'ok',
      on: status === 'done' && !quick,
      pick: () => { setQuick(''); setStatus(s => (s === 'done' ? '' : 'done')) } },
    { id: 'remaining', label: t('deals.kpi.remaining'), value: `${fmtNum(ov.rem_sum)} ${SAR}`,
      sub: t('deals.kpi.onDeals', { n: fmtNum(ov.rem_count) }), tone: 'warn',
      on: quick === 'remaining',
      pick: () => { setStatus(''); setQuick(q => (q === 'remaining' ? '' : 'remaining')) } },
    { id: 'overdue', label: t('deals.quick.overdue'), value: fmtNum(ov.overdue_count),
      sub: t('deals.flags.overdue'), tone: ov.overdue_count > 0 ? 'danger' : 'muted',
      on: quick === 'overdue',
      pick: () => { setStatus(''); setQuick(q => (q === 'overdue' ? '' : 'overdue')) } },
    { id: 'waiting', label: t('deals.kpi.waiting'), value: fmtNum(ov.waiting_count),
      sub: t('deals.kpi.netOf', { n: fmtNum(ov.waiting_net), cur: SAR }), tone: 'primary',
      on: status === 'waiting' && !quick,
      pick: () => { setQuick(''); setStatus(s => (s === 'waiting' ? '' : 'waiting')) } },
  ]
  const tabCount = (id) => (id ? ov.by_status?.[id] ?? 0 : ov.total ?? 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('deals.title')}</h1>
          <div className="hint">
            {t('deals.countSorted', { n: fmtNum(total), by: t(DEAL_SORTS[sort.key].label) })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={doExport} disabled={exporting || !total}>
            {exporting ? t('exportLeads.exporting') : `⬇ ${t('deals.exportCsv')}`}
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ {t('deals.newDeal')}</button>
        </div>
      </div>

      {/* نوع البيع — بيفلتر الصفحة كلها */}
      <div className="deals-tabs deals-kinds" role="tablist" aria-label={t('deal.saleType')}>
        {KINDS.map(k => {
          const on = kind === k
          const n = k
            ? Number(ov.by_kind?.[k] ?? 0)
            : Object.values(ov.by_kind ?? {}).reduce((acc, x) => acc + Number(x), 0)
          if (k && !n && !on) return null      // نوع مالوش ديلات مايظهرش
          return (
            <button key={k || 'all'} type="button" role="tab" aria-selected={on}
              className={'deals-tab' + (on ? ' on' : '')} onClick={() => setKind(k)}>
              {k ? kindLabel(k) : t('deals.allSales')}
              <span className="deals-tab-count">{fmtNum(n)}</span>
            </button>
          )
        })}
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
          <div className="deals-tabs" role="tablist" aria-label={t('deals.dealStatus')}>
            {TABS.map(tb => {
              const on = status === tb && !quick
              return (
                <button key={tb || 'all'} type="button" role="tab" aria-selected={on}
                  className={'deals-tab' + (on ? ' on' : '')}
                  onClick={() => { setQuick(''); setStatus(tb) }}>
                  {t(`deals.tabs.${tb || 'all'}`)}
                  <span className="deals-tab-count">{fmtNum(tabCount(tb))}</span>
                </button>
              )
            })}
          </div>

          <div className="deals-period">
            <span>{t('deals.dateOperation')}:</span>
            {[
              { id: 'this', label: monthName(0) },
              { id: 'last', label: monthName(-1) },
              { id: 'custom', label: t('deals.custom') },
              { id: 'all', label: t('common.all') },
            ].map(p => (
              <button key={p.id} type="button" aria-pressed={period === p.id}
                className={'chip' + (period === p.id ? ' on' : '')}
                onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <>
                <input type="date" aria-label={t('drawer.from')} value={from} onChange={e => setFrom(e.target.value)} />
                <input type="date" aria-label={t('leads.f.to')} value={to} onChange={e => setTo(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="filters-bar deals-filters">
          <input className="filter-search" placeholder={t('leads.searchPh')}
            aria-label={t('common.search')} value={search} onChange={e => setSearch(e.target.value)} />

          <select aria-label={t('lead.branch')} value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="">{t('leads.f.allBranches')}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
          </select>

          {!isAgent && (
            <select aria-label={t('roles.agent')} value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">{t('leads.allSales')}</option>
              {(refs.agents ?? []).some(a => a.id === profile?.id) && <option value={profile.id}>{t('deals.myDeals')}</option>}
              {(refs.agents ?? []).filter(a => a.id !== profile?.id)
                .map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
            </select>
          )}

          <select aria-label={t('lead.coordShort')} value={coordId} onChange={e => setCoordId(e.target.value)}>
            <option value="">{t('leads.allCoords')}</option>
            {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>

          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>{t('deals.clearFilters')}</button>
          )}
        </div>

        {quick && (
          <div className="deals-quick">
            <span>{t('deals.quickFilter')}:</span>
            <button type="button" className="chip on" onClick={() => setQuick('')}
              aria-label={`${t('common.cancel')} ${t(`deals.quick.${quick}`)}`}>
              {t(`deals.quick.${quick}`)} ✕
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : deals.length === 0 ? (
        <div className="card empty">
          <strong>{hasFilters ? t('deals.noMatch') : t('deals.noDeals')}</strong>
          {hasFilters
            ? <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={clearAll}>{t('deals.clearFilters')}</button>
            : t('deals.noDealsHint')}
        </div>
      ) : isMobile ? (
        <ul className="mcards">
          {deals.map(d => <DealCard key={d.id} d={d} onOpen={() => setOpenDeal(d)} />)}
        </ul>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="table deals-table">
            <thead>
              <tr>
                <th>{t('lead.client')}</th>
                <th>{t('deals.sale')}</th>
                <th>{t('deals.team')}</th>
                <th aria-sort={sort.key === 'date' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'date' ? ' on' : '')}
                    onClick={() => toggleSort('date')}>{t('deals.dateOperation')} {sortArrow('date')}</button>
                </th>
                <th aria-sort={sort.key === 'net' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'net' ? ' on' : '')}
                    onClick={() => toggleSort('net')}>{t('deals.sorts.net')} {sortArrow('net')}</button>
                </th>
                <th style={{ minWidth: 190 }}
                  aria-sort={sort.key === 'remaining' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={'th-sort' + (sort.key === 'remaining' ? ' on' : '')}
                    onClick={() => toggleSort('remaining')}>{t('deals.collection')} {sortArrow('remaining')}</button>
                </th>
                <th>{t('deals.status')}</th>
                <th>{t('deals.alerts')}</th>
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
                const rel = days == null ? t('deals.notSet')
                  : days === 0 ? t('deals.today')
                  : days > 0 ? t('deals.inDays', { n: fmtNum(days) }) : t('deals.daysAgo', { n: fmtNum(-days) })
                const flags = dealFlags(d, t)
                return (
                  <tr key={d.id} onClick={() => setOpenDeal(d)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="deals-name">{d.full_name ?? '—'}</div>
                      {d.phone && (
                        <div className="phone-cell deals-sub">
                          <span>{d.phone}</span>
                          <button type="button" className="icon-btn"
                            title={copied === d.phone ? t('deals.copied') : t('lead.copyPhone')}
                            aria-label={t('lead.copyPhone')}
                            onClick={e => copyPhone(e, d.phone)}>
                            {copied === d.phone ? '✓' : '⧉'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{dn({ name_ar: d.procedure_name, name_en: d.procedure_name_en }) || '—'}</span>
                        {d.procedure_kind !== 'surgery' && (
                          <span className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                            {d.procedure_kind === 'product' ? t('deals.unit.product') : t('kind.treatment')}
                          </span>
                        )}
                        {d.procedure_kind === 'surgery' && d.procedure_no > 1 && (
                          <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                            {t('deals.operationN', { n: d.procedure_no })}
                          </span>
                        )}
                      </div>
                      <div className="deals-sub">
                        {[d.technique_name, d.grafts ? `${fmtNum(d.grafts)} ${t('deals.graftUnit')}` : null, dn({ name: d.branch_name, name_en: d.branch_name_en })]
                          .filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div><span className="deals-muted">{t('rolesShort.agent')}:</span> {d.agent_name ?? '—'}</div>
                      <div style={{ marginTop: 3 }}>
                        <span className="deals-muted">{t('lead.coordShort')}:</span>{' '}
                        {d.coordinator_name ?? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('deals.notSet')}</span>}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{d.operation_date ? fmtDate(d.operation_date) : '—'}</div>
                      <div className="deals-sub">{rel}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{fmtNum(d.net_amount)} {SAR}</td>
                    <td>
                      {closed ? (
                        <span className="deals-muted">—</span>
                      ) : (
                        <>
                          <div className="deals-bar" role="img"
                            aria-label={t('deals.collectedPct', { pct })}>
                            <span className={rem > 0 ? 'part' : 'full'} style={{ width: pct + '%' }} />
                          </div>
                          <div className="deals-bar-meta">
                            <span className="deals-muted">{fmtNum(collected)} {t('common.collected')}</span>
                            {rem > 0
                              ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('deals.sorts.remaining')} {fmtNum(rem)}</span>
                              : <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{t('payStatus.paid')}</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={'badge ' + (st?.cls ?? '')}>{st ? t(st.label) : d.status}</span>
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
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('common.perPage')}</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ width: 80 }}>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          {total > pageSize && (
            <>
              <button className="btn btn-ghost" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>{t('common.prev')}</button>
              <span className="pager-info">
                {t('common.pageOf', { page: fmtNum(page + 1), total: fmtNum(totalPages) })}
              </span>
              <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
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
