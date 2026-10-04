// الليدات على الموبايل — بدل الكانبان:
// شرائح المراحل بأعدادها فوق، ومرضى المرحلة المختارة تحت بعض
// كل كارت: الاسم + حالة المتابعة + اتصال/واتساب مباشرة من غير فتح الملف
// البحث: لستة واحدة بكل النتائج من كل المراحل (مع اسم المرحلة على الكارت)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useT from '../i18n/useT'
import { timeAgo, fmtDateTime, openWhatsApp } from '../lib/format'
import {
  fetchStageColumn, fetchBoardCounts, fetchBoardSearch, canBoardCount, hasTaskFilter, computeAlert,
} from './useLeadRefs'
import { onBoardPatch } from './boardBus'

const PAGE = 30

// نفس ترتيب الأعمدة اللي الموظف ظبطه في الكانبان على الكمبيوتر
function useOrderedStages(board, stages) {
  return useMemo(() => {
    let order = []
    try { order = JSON.parse(localStorage.getItem(`kanban-order-${board}`) || '[]') } catch {}
    const byId = Object.fromEntries(stages.map(s => [s.id, s]))
    const seen = new Set(), out = []
    for (const id of Array.isArray(order) ? order : []) if (byId[id]) { out.push(byId[id]); seen.add(id) }
    for (const s of stages) if (!seen.has(s.id)) out.push(s)
    return out
  }, [board, stages])
}

// سطر الحالة تحت الاسم
function statusOf(l, t) {
  if (l.follow_paused) return { text: t('mlist.paused'), tone: 'muted' }
  const late = computeAlert(l)
  if (late > 0) return { text: t('mlist.late', { n: late }), tone: 'danger' }
  const next = (l.tasks ?? []).filter(x => x.status === 'open')
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0]
  if (next) {
    const d = new Date(next.due_at)
    const isToday = d.toDateString() === new Date().toDateString()
    return isToday
      ? { text: t('mlist.today', { time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }), tone: 'primary' }
      : { text: t('mlist.next', { when: fmtDateTime(next.due_at) }), tone: 'primary' }
  }
  if (l.snooze_until && new Date(l.snooze_until) > new Date()) return { text: t('mlist.snoozed'), tone: 'muted' }
  return { text: t('mlist.lastActivity', { ago: timeAgo(l.last_activity) }), tone: 'muted' }
}

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
  </svg>
)
const WaIcon = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
  </svg>
)

function LeadRow({ lead, stageName, onOpen }) {
  const { t, dn } = useT()
  const st = statusOf(lead, t)
  return (
    <li className="mlead">
      <button type="button" className="mlead-main" onClick={onOpen}>
        <span className="mlead-name">{lead.full_name || lead.phone}</span>
        <span className={'mlead-status tone-' + st.tone}>{st.text}</span>
        <span className="mlead-meta">
          {stageName && <span className="mlead-stage" style={{ '--stage': lead.stages?.color ?? '#888' }}>{stageName}</span>}
          {dn(lead.lead_sources) && <span>{dn(lead.lead_sources)}</span>}
          {lead.attempts > 0 && <span>{t('kanban.attempts', { n: lead.attempts })}</span>}
        </span>
      </button>
      {lead.phone && (
        <div className="mlead-actions">
          <a className="mlead-act" href={`tel:${lead.phone}`} aria-label={t('lead.call')} title={t('lead.call')}><PhoneIcon /></a>
          <button type="button" className="mlead-act wa" aria-label="WhatsApp" title="WhatsApp"
            onClick={() => openWhatsApp(lead.phone)}><WaIcon /></button>
        </div>
      )}
    </li>
  )
}

export default function MobileLeadList({ board, stages, filters, sort, refreshKey, onOpen }) {
  const { t, dn } = useT()
  const ordered = useOrderedStages(board, stages)
  const searchMode = !!filters.search && !hasTaskFilter(filters)
  const countMode = !searchMode && canBoardCount(filters)

  // المرحلة المختارة — محفوظة لكل بورد
  const storeKey = `mlist-stage-${board}`
  const [picked, setPicked] = useState(() => {
    try { return Number(localStorage.getItem(storeKey)) || null } catch { return null }
  })
  useEffect(() => {
    try { setPicked(Number(localStorage.getItem(storeKey)) || null) } catch { setPicked(null) }
  }, [storeKey])
  const stage = ordered.find(s => s.id === picked) ?? ordered[0] ?? null
  const choose = (id) => {
    setPicked(id)
    try { localStorage.setItem(storeKey, String(id)) } catch {}
  }

  const [counts, setCounts] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)

  useEffect(() => { setLimit(PAGE) }, [filters, sort, stage?.id])

  const stageIds = useMemo(() => ordered.map(s => s.id), [ordered])

  const loadCounts = useCallback(async () => {
    if (!countMode || !stageIds.length) { setCounts(null); return }
    const map = await fetchBoardCounts({ stageIds, filters })
    if (map) setCounts(map)
  }, [countMode, stageIds, filters])

  const loadRows = useCallback(async ({ quiet = false } = {}) => {
    if (!stageIds.length) { setRows([]); setLoading(false); return }
    if (!quiet) setLoading(true)
    if (searchMode) {
      const res = await fetchBoardSearch({ stageIds, filters, sort })
      const flat = ordered.flatMap(s => res.byStage[s.id] ?? [])
      setRows(flat); setTotal(flat.length)
      setCounts(Object.fromEntries(ordered.map(s => [s.id, (res.byStage[s.id] ?? []).length])))
    } else if (stage) {
      const res = await fetchStageColumn({ stageId: stage.id, filters, limit, sort, withCount: !countMode })
      setRows(res.rows)
      if (res.total !== null) setTotal(res.total)
    }
    setLoading(false); setMore(false)
  }, [stageIds, searchMode, filters, sort, ordered, stage, limit, countMode])

  useEffect(() => { loadCounts() }, [loadCounts, refreshKey])
  useEffect(() => { loadRows() }, [loadRows])

  // تحديث هادئ مع refresh جماعي (ليد جديد / إجراء جماعي)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    loadRows({ quiet: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // تغييرات من الدرور أو Realtime — نفس قناة الكانبان
  const loadRowsRef = useRef(loadRows), loadCountsRef = useRef(loadCounts), rowsRef = useRef(rows)
  useEffect(() => { loadRowsRef.current = loadRows }, [loadRows])
  useEffect(() => { loadCountsRef.current = loadCounts }, [loadCounts])
  useEffect(() => { rowsRef.current = rows }, [rows])
  const timer = useRef(null)
  useEffect(() => onBoardPatch((d) => {
    if (d.removeId != null && stage && d.removeFrom === stage.id && !searchMode) {
      setRows(rs => rs.filter(r => String(r.id) !== String(d.removeId)))
      setTotal(n => Math.max(0, n - 1))
    }
    if (d.removeId != null && d.removeFrom != null) {
      setCounts(c => (c && c[d.removeFrom] > 0 ? { ...c, [d.removeFrom]: c[d.removeFrom] - 1 } : c))
    }
    const touchesMe = d.refetchAll
      || (d.id != null && rowsRef.current.some(r => String(r.id) === String(d.id)))
      || (Array.isArray(d.refetch) && (searchMode || (stage && d.refetch.includes(stage.id))))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      loadCountsRef.current()
      if (touchesMe) loadRowsRef.current({ quiet: true })
    }, d.refetchAll ? 0 : 600)
  }), [stage, searchMode])
  useEffect(() => () => clearTimeout(timer.current), [])

  // الشريحة المختارة تبان على الشاشة
  const chipsRef = useRef(null)
  useEffect(() => {
    chipsRef.current?.querySelector('.mstage.on')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [stage?.id, ordered.length])

  const shownTotal = searchMode ? rows.length
    : countMode && stage && typeof counts?.[stage.id] === 'number' ? Math.max(counts[stage.id], rows.length)
    : total
  const hidden = searchMode ? 0 : Math.max(0, shownTotal - rows.length)

  if (!ordered.length) return null

  return (
    <div className="mlist">
      {!searchMode && (
        <div className="mstages" ref={chipsRef} role="tablist">
          {ordered.map(s => {
            const n = counts?.[s.id] ?? (s.id === stage?.id && !loading ? shownTotal : null)
            return (
              <button key={s.id} type="button" role="tab" aria-selected={s.id === stage?.id}
                className={'mstage' + (s.id === stage?.id ? ' on' : '')}
                style={{ '--stage': s.color ?? '#888' }} onClick={() => choose(s.id)}>
                <i className="dot" />
                {dn(s)}
                {n != null && <span className="n">{Number(n).toLocaleString('en-US')}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="mlist-caption">
        {searchMode
          ? t('mlist.searchResults', { n: rows.length.toLocaleString('en-US') })
          : sort === 'oldest' ? t('mlist.sortOldest') : t('mlist.sortRecent')}
      </div>

      {loading ? (
        <div className="mlist-empty">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="mlist-empty">
          <strong>{searchMode ? t('leads.noResults') : t('mlist.emptyStage')}</strong>
        </div>
      ) : (
        <ul className="mlist-rows">
          {rows.map(l => (
            <LeadRow key={l.id} lead={l}
              stageName={searchMode ? dn(l.stages) : null}
              onOpen={() => onOpen(l, rows)} />
          ))}
        </ul>
      )}

      {hidden > 0 && !loading && (
        <button type="button" className="mlist-more" disabled={more}
          onClick={() => { setMore(true); setLimit(n => n + PAGE) }}>
          {more ? t('common.loading') : t('mlist.showMore', { left: hidden.toLocaleString('en-US') })}
        </button>
      )}
    </div>
  )
}
