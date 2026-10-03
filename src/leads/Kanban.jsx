// الكانبان — كل عمود يجلب أحدث N ليد، والأعداد كلها في نداء واحد (board_counts)
// البحث: استعلام واحد على كل المراحل ويتوزّع على الأعمدة محليًا
// + إشعار أحمر بعدد أيام التأخير على كل كارت
// + ترتيب الأعمدة بالسحب محفوظ محليًا
// + تمرير أفقي تلقائي عند تقريب الماوس من حافة البورد
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { timeAgo } from '../lib/format'
import {
  fetchStageColumn, computeAlert, fetchBoardSearch, fetchBoardCounts, canBoardCount,
  hasTaskFilter, BOARD_SEARCH_LIMIT,
} from './useLeadRefs'
import { onBoardPatch } from './boardBus'
import useT from '../i18n/useT'

const COL_FIRST = 50   // الدفعة الأولى
const COL_MORE  = 20   // كل ضغطة "عرض المزيد" 

// إعدادات التمرير التلقائي
const EDGE_ZONE  = 90   // عرض المنطقة الحسّاسة عند الحافة (بكسل)
const MAX_SPEED  = 22   // أقصى سرعة تمرير لكل إطار

// أوضاع العمود:
//  • searchRows موجودة  → وضع البحث: العمود بيعرض اللي البورد جابه، ومبيعملش أي نداء
//  • externalTotal رقم → العدد جاي من board_counts، والعمود يجيب الصفوف بس (من غير count)
//  • غير كده           → العمود يجيب الصفوف + العدد بنفسه (فلاتر التاسكات/الفترات/السعر…)
function StageColumn({ stage, filters, onOpen, dragProps, tick, sort, refreshKey, searchRows, searchLoading, externalTotal, useExternalCount }) {
  const { t, dn } = useT()
  const searchMode = Array.isArray(searchRows)
  const [ownRows, setRows] = useState([])
  const [ownTotal, setTotal] = useState(0)
  const [ownLoading, setLoading] = useState(!searchMode)
  const [limit, setLimit] = useState(COL_FIRST)
  const [more, setMore] = useState(false)

  const rows = searchMode ? searchRows : ownRows
  const total = searchMode
    ? searchRows.length
    : useExternalCount
      ? (typeof externalTotal === 'number' ? Math.max(externalTotal, ownRows.length) : ownRows.length)
      : ownTotal
  const loading = searchMode ? !!searchLoading : ownLoading

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (searchMode) return
    if (!quiet) setLoading(true)
    const { rows, total } = await fetchStageColumn({
      stageId: stage.id, filters, limit, sort, withCount: !useExternalCount,
    })
    setRows(rows)
    if (total !== null) setTotal(total)
    setLoading(false)
    setMore(false)
  }, [stage.id, filters, limit, sort, searchMode, useExternalCount])

  useEffect(() => { load() }, [load])

  // تغيّر الفلاتر أو الترتيب يعيد العمود لدفعته الأولى
  useEffect(() => { setLimit(COL_FIRST) }, [filters, sort, stage.id])

  // إعادة تحميل جماعية هادئة — تُستعمل فقط لإضافة ليد جديد والإجراءات الجماعية
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    load({ quiet: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // تحديث موضعي عبر boardBus (تغيير مرحلة/تواصل/تعديل من الدرور):
  // العمود المصدر يشيل الكارت فورًا محليًا، والعمود المتأثر فقط يحدّث نفسه.
  // باقي الأعمدة لا تُلمَس — فلا refresh جماعي يعطّل مع النت البطيء.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  // نسخة حيّة من الصفوف — عشان نعرف الكارت موجود في العمود ده ولا لأ
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  // تحديث هادئ مؤجَّل: أحداث Realtime بتيجي دفعات (توزيع جماعي، رسايل واتساب ورا بعض)
  // فنجمعها في نداء واحد للعمود بدل نداء لكل حدث
  const timerRef = useRef(null)
  const scheduleQuiet = useCallback((ms = 400) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => loadRef.current({ quiet: true }), ms)
  }, [])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => onBoardPatch((d) => {
    if (d.refetchAll) { scheduleQuiet(0); return }
    if (d.realtime) {
      const has = d.id != null && rowsRef.current.some(r => String(r.id) === String(d.id))
      if (has || (Array.isArray(d.refetch) && d.refetch.includes(stage.id))) scheduleQuiet()
      return
    }
    if (d.removeId != null && d.removeFrom === stage.id) {
      setRows(rs => rs.filter(r => String(r.id) !== String(d.removeId)))
      setTotal(t => Math.max(0, t - 1))
    }
    if (Array.isArray(d.refetch) && d.refetch.includes(stage.id)) {
      loadRef.current({ quiet: true })
    }
  }), [stage.id, scheduleQuiet])

  const hidden = searchMode ? 0 : total - rows.length

  function loadMore() {
    setMore(true)
    setLimit(l => l + COL_MORE)
  }

  return (
    <div {...dragProps}>
      <div className="kanban-head" style={{ '--stage': stage.color }}>
        <span className="drag-handle" title={t('kanban.dragToReorder')}>⋮⋮</span>
        <span className="dot" />
        <span className="name">{dn(stage)}</span>
        <span className="count">{total.toLocaleString('en-US')}</span>
      </div>

      <div className="kanban-body">
        {loading && <div className="kanban-empty">…</div>}
        {!loading && rows.length === 0 && <div className="kanban-empty">{t('kanban.empty')}</div>}
        {rows.map(l => {
          const alert = computeAlert(l)
          return (
            <button className="lead-card" key={l.id}
              onClick={() => onOpen(l, rows)}>
              {alert > 0 && (
                <span className="lead-alert" title={t('kanban.lateDays', { n: alert })}>{alert}</span>
              )}
              <div className="lead-name">{l.full_name}</div>
              <div className="lead-meta"><span dir="ltr">{l.phone}</span></div>
              <div className="lead-foot">
                <span>{dn(l.lead_sources) || '—'}</span>
                <span>{timeAgo(l.last_activity)}</span>
              </div>
              {l.attempts > 0 && <div className="lead-attempts">{t('kanban.attempts', { n: l.attempts })}</div>}
            </button>
          )
        })}
        {hidden > 0 && (
          <button className="kanban-more" onClick={loadMore} disabled={more}>
            {more
              ? t('common.loading')
              : t('kanban.showMore', { n: Math.min(COL_MORE, hidden).toLocaleString('en-US'), left: hidden.toLocaleString('en-US') })}
          </button>
        )}
        {hidden === 0 && rows.length > COL_FIRST && (
          <div className="kanban-end">{t('kanban.allShown', { n: rows.length.toLocaleString('en-US') })}</div>
        )}
      </div>
    </div>
  )
}

export default function Kanban({ board, stages, filters, onOpen, sort = 'recent', refreshKey }) {
  const { t } = useT()
  const storageKey = `kanban-order-${board}`
  const [order, setOrder] = useState([])
  const [dragId, setDragId] = useState(null)
  const [tick, setTick] = useState(0)

  // ---------- وضع البورد: بحث (نداء واحد) / أعداد مجمّعة (نداء واحد) / كل عمود لوحده ----------
  const stageIds = useMemo(() => stages.map(s => s.id), [stages])
  const searchMode = !!filters.search && !hasTaskFilter(filters)
  const countMode = !searchMode && canBoardCount(filters)

  const [counts, setCounts] = useState(null)          // stageId → عدد
  const [search, setSearch] = useState({ byStage: {}, capped: false, loading: searchMode })

  const loadCounts = useCallback(async () => {
    if (!countMode || !stageIds.length) return
    const map = await fetchBoardCounts({ stageIds, filters })
    if (map) setCounts(map)
  }, [countMode, stageIds, filters])

  const loadSearch = useCallback(async ({ quiet = false } = {}) => {
    if (!searchMode || !stageIds.length) return
    if (!quiet) setSearch(s => ({ ...s, loading: true }))
    const res = await fetchBoardSearch({ stageIds, filters, sort })
    setSearch({ byStage: res.byStage, capped: res.capped, loading: false })
  }, [searchMode, stageIds, filters, sort])

  useEffect(() => { loadCounts() }, [loadCounts, refreshKey])
  useEffect(() => { loadSearch() }, [loadSearch, refreshKey])

  // أي تغيير (من الدرور أو Realtime) → نداء واحد مؤجَّل للأعداد أو للبحث، مش نداء لكل عمود
  const boardTimer = useRef(null)
  const loadCountsRef = useRef(loadCounts)
  const loadSearchRef = useRef(loadSearch)
  useEffect(() => { loadCountsRef.current = loadCounts }, [loadCounts])
  useEffect(() => { loadSearchRef.current = loadSearch }, [loadSearch])
  useEffect(() => onBoardPatch((d) => {
    // تحديث فوري محلي لعدد العمود المصدر عند النقل
    if (d.removeId != null && d.removeFrom != null) {
      setCounts(c => (c && c[d.removeFrom] > 0 ? { ...c, [d.removeFrom]: c[d.removeFrom] - 1 } : c))
      setSearch(s => {
        const list = s.byStage[d.removeFrom]
        if (!list) return s
        return { ...s, byStage: { ...s.byStage, [d.removeFrom]: list.filter(r => String(r.id) !== String(d.removeId)) } }
      })
    }
    clearTimeout(boardTimer.current)
    boardTimer.current = setTimeout(() => {
      loadCountsRef.current()
      loadSearchRef.current({ quiet: true })
    }, d.refetchAll ? 0 : 1500)
  }), [])
  useEffect(() => () => clearTimeout(boardTimer.current), [])

  // ---------- التمرير التلقائي عند الحواف ----------
  const boardRef = useRef(null)
  const speedRef = useRef(0)      // موجب = يمين، سالب = شمال
  const rafRef   = useRef(null)
  const [edge, setEdge] = useState(0)   // -1 شمال، 1 يمين، 0 لا شيء

  const stopScroll = useCallback(() => {
    speedRef.current = 0
    setEdge(0)
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  const step = useCallback(() => {
    const el = boardRef.current
    if (!el || !speedRef.current) { rafRef.current = null; return }
    el.scrollLeft += speedRef.current
    rafRef.current = requestAnimationFrame(step)
  }, [])

  const onMouseMove = useCallback((e) => {
    const el = boardRef.current
    if (!el) return

    // لا داعي للتمرير إذا كان المحتوى يسع الشاشة
    if (el.scrollWidth <= el.clientWidth + 4) { stopScroll(); return }

    const box = el.getBoundingClientRect()
    const fromLeft  = e.clientX - box.left
    const fromRight = box.right - e.clientX

    let speed = 0
    let side = 0
    if (fromLeft < EDGE_ZONE) {
      // كلما اقترب أكثر من الحافة زادت السرعة
      speed = -Math.ceil(((EDGE_ZONE - fromLeft) / EDGE_ZONE) * MAX_SPEED)
      side = -1
    } else if (fromRight < EDGE_ZONE) {
      speed = Math.ceil(((EDGE_ZONE - fromRight) / EDGE_ZONE) * MAX_SPEED)
      side = 1
    }

    speedRef.current = speed
    setEdge(side)

    if (speed && !rafRef.current) rafRef.current = requestAnimationFrame(step)
    if (!speed && rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [step, stopScroll])

  // تنظيف عند إغلاق الصفحة
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  // عجلة الماوس:
  // - فوق عمود لا يزال قابلًا للتمرير رأسيًا → اترك المتصفح ينزّل العمود (السلوك الطبيعي)
  // - العمود وصل لنهايته أو لا يمكن تمريره → حوّل الحركة إلى تمرير أفقي للبورد
  // - Shift + عجلة → تمرير أفقي دائمًا (السلوك المتعارف عليه)
  const onWheel = useCallback((e) => {
    const el = boardRef.current
    if (!el) return

    const canScrollX = el.scrollWidth > el.clientWidth + 4
    if (!canScrollX) return

    // Shift = تمرير أفقي صريح
    if (e.shiftKey) {
      el.scrollLeft += (e.deltaY || e.deltaX)
      return
    }

    // حركة أفقية أصلًا (لوحة لمس) → اتركها للمتصفح
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return

    // هل يوجد عمود تحت المؤشر ولا يزال بإمكانه التمرير في هذا الاتجاه؟
    const body = e.target.closest?.('.kanban-body')
    if (body) {
      const room = body.scrollHeight - body.clientHeight
      if (room > 1) {
        const atTop = body.scrollTop <= 0
        const atBottom = body.scrollTop >= room - 1
        const goingDown = e.deltaY > 0
        // العمود ما زال قادرًا على الاستيعاب → لا تتدخّل
        if ((goingDown && !atBottom) || (!goingDown && !atTop)) return
      }
    }

    // العمود انتهى (أو المؤشر خارج أي عمود) → حرّك البورد أفقيًا
    el.scrollLeft += e.deltaY
  }, [])

  // إعادة حساب الإشعارات كل دقيقة (بدون جلب من القاعدة)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      setOrder(Array.isArray(saved) ? saved : [])
    } catch { setOrder([]) }
  }, [storageKey])

  const orderedStages = useMemo(() => {
    const byId = Object.fromEntries(stages.map(s => [s.id, s]))
    const seen = new Set()
    const result = []
    for (const id of order) if (byId[id]) { result.push(byId[id]); seen.add(id) }
    for (const s of stages) if (!seen.has(s.id)) result.push(s)
    return result
  }, [stages, order])

  function persist(ids) {
    setOrder(ids)
    try { localStorage.setItem(storageKey, JSON.stringify(ids)) } catch {}
  }

  function onDrop(targetId) {
    if (dragId == null || dragId === targetId) { setDragId(null); return }
    const ids = orderedStages.map(s => s.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    persist(ids)
    setDragId(null)
  }

  return (
    <div className="kanban-scroll-wrap">
      {searchMode && !search.loading && search.capped && (
        <div className="kanban-search-note">
          {t('kanban.searchCapped', { n: BOARD_SEARCH_LIMIT.toLocaleString('en-US') })}
        </div>
      )}
      <div className="kanban-edge start" data-on={edge === -1} />
      <div className="kanban-edge end"   data-on={edge === 1} />

      <div
        className="kanban"
        ref={boardRef}
        onMouseMove={onMouseMove}
        onMouseLeave={stopScroll}
        onWheel={onWheel}
      >
        {orderedStages.map(st => (
          <StageColumn
            key={st.id}
            stage={st}
            filters={filters}
            onOpen={onOpen}
            tick={tick}
            sort={sort}
            refreshKey={refreshKey}
            searchRows={searchMode ? (search.byStage[st.id] ?? []) : undefined}
            searchLoading={searchMode && search.loading}
            useExternalCount={countMode}
            externalTotal={counts?.[st.id]}
            dragProps={{
              draggable: true,
              className: 'kanban-col' + (dragId === st.id ? ' dragging' : ''),
              onDragStart: () => setDragId(st.id),
              onDragOver: e => e.preventDefault(),
              onDrop: () => onDrop(st.id),
            }}
          />
        ))}
      </div>
    </div>
  )
}
