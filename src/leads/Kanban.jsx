// الكانبان — كل عمود يجلب أحدث N ليد + العدد الحقيقي من القاعدة
// + إشعار أحمر بعدد أيام التأخير على كل كارت
// + ترتيب الأعمدة بالسحب محفوظ محليًا
// + تمرير أفقي تلقائي عند تقريب الماوس من حافة البورد
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { timeAgo } from '../lib/format'
import { fetchStageColumn, computeAlert } from './useLeadRefs'

const COL_LIMIT = 50

// إعدادات التمرير التلقائي
const EDGE_ZONE  = 90   // عرض المنطقة الحسّاسة عند الحافة (بكسل)
const MAX_SPEED  = 22   // أقصى سرعة تمرير لكل إطار

function StageColumn({ stage, filters, onOpen, dragProps, tick }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows, total } = await fetchStageColumn({ stageId: stage.id, filters, limit: COL_LIMIT })
    setRows(rows)
    setTotal(total)
    setLoading(false)
  }, [stage.id, filters])

  useEffect(() => { load() }, [load])

  const hidden = total - rows.length

  return (
    <div {...dragProps}>
      <div className="kanban-head" style={{ '--stage': stage.color }}>
        <span className="drag-handle" title="اسحب لإعادة الترتيب">⋮⋮</span>
        <span className="dot" />
        <span className="name">{stage.name_ar}</span>
        <span className="count">{total.toLocaleString('en-US')}</span>
      </div>

      <div className="kanban-body">
        {loading && <div className="kanban-empty">…</div>}
        {!loading && rows.length === 0 && <div className="kanban-empty">لا شيء هنا</div>}
        {rows.map(l => {
          const alert = computeAlert(l)
          return (
            <button className="lead-card" key={l.id}
              onClick={() => onOpen(l, rows)}>
              {alert > 0 && (
                <span className="lead-alert" title={`متأخر ${alert} يوم`}>{alert}</span>
              )}
              <div className="lead-name">{l.full_name}</div>
              <div className="lead-meta"><span dir="ltr">{l.phone}</span></div>
              <div className="lead-foot">
                <span>{l.lead_sources?.name_ar ?? '—'}</span>
                <span>{timeAgo(l.last_activity)}</span>
              </div>
              {l.attempts > 0 && <div className="lead-attempts">محاولات: {l.attempts}</div>}
            </button>
          )
        })}
        {hidden > 0 && (
          <div className="kanban-more">
            + {hidden.toLocaleString('en-US')} ليد أقدم — استخدم الجدول أو الفلاتر لعرضهم
          </div>
        )}
      </div>
    </div>
  )
}

export default function Kanban({ board, stages, filters, onOpen }) {
  const storageKey = `kanban-order-${board}`
  const [order, setOrder] = useState([])
  const [dragId, setDragId] = useState(null)
  const [tick, setTick] = useState(0)

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
