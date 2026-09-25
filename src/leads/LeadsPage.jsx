// صفحة الليدات — شرائح فلترة سريعة + لوحة تفصيلية + بوردان + جدول مقسّم
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLeadRefs, fetchLeadsPage } from './useLeadRefs'
import Kanban from './Kanban'
import LeadsTable from './LeadsTable'
import AddLeadModal from './AddLeadModal'
import LeadDrawer from './LeadDrawer'
import ExportLeadsModal from './ExportLeadsModal'
import BulkActionsBar from './BulkActionsBar'
import { supabase } from '../lib/supabase'

const EMPTY_FILTERS = {
  search: '', stage: '', source: '', owner: '', coordinator: '', branch: '', interest: '',
  createdFrom: '', createdTo: '',
  // فترات: اتحرّك من/إلى + عدد مكالمات السنترال في فترة
  movedFrom: '', movedTo: '',
  callsFrom: '', callsTo: '', callsMin: '', callsMax: '', callsAnswered: false,
  priceFrom: '', priceTo: '', ageFrom: '', ageTo: '',
  // أعلام
  movedToday: false, stale: false, paused: false, noOwner: false,
  transferredToday: false, snoozed: false,
  alertOnly: false, taskToday: false, taskOverdue: false, noTask: false,
}

export default function LeadsPage() {
  const { isManager, roleCode, profile } = useAuth()
  const refs = useLeadRefs()
  const [branches, setBranches] = useState([])
  // اختيار العرض يُحفظ محليًا فلا يضيع عند إعادة تحميل الصفحة
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('leads-view') || 'kanban' } catch { return 'kanban' }
  })
  useEffect(() => {
    try { localStorage.setItem('leads-view', view) } catch {}
  }, [view])

  // ترتيب الأعمدة — الأقدم يُظهر المهملين أولًا
  const [sort, setSort] = useState(() => {
    try { return localStorage.getItem('leads-sort') || 'recent' } catch { return 'recent' }
  })
  useEffect(() => {
    try { localStorage.setItem('leads-sort', sort) } catch {}
  }, [sort])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // البحث بـ debounce: الحقل يستجيب فورًا، لكن الاستعلام ينتظر توقّف الكتابة 300ms
  // فلا يُطلق استعلامًا (وremount للكانبان) مع كل ضغطة زر
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300)
    return () => clearTimeout(id)
  }, [filters.search])
  const [showAdd, setShowAdd] = useState(false)
  const [openLead, setOpenLead] = useState(null)
  const [navList, setNavList] = useState([])   // قائمة التنقّل: صفوف العمود أو الجدول
  const [showMore, setShowMore] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  const [board, setBoard] = useState(roleCode === 'coordinator' ? 'coordinator' : 'sales')
  const [showArchive, setShowArchive] = useState(false)
  const [archived, setArchived] = useState([])
  const [loadingArch, setLoadingArch] = useState(false)

  const [pageSize, setPageSize] = useState(50)
  const [tableRows, setTableRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [chipCounts, setChipCounts] = useState({})

  useEffect(() => {
    import('../lib/supabase').then(({ supabase }) =>
      supabase.from('branches').select('id, name').eq('is_active', true).order('name')
        .then(({ data }) => setBranches(data ?? [])))
  }, [])

  const boardStages = useMemo(
    () => refs.stages.filter(s => (s.board ?? 'sales') === board),
    [refs.stages, board]
  )
  const boardStageIds = useMemo(() => boardStages.map(s => s.id), [boardStages])

  const salesAgents = useMemo(
    () => (refs.agents ?? []).filter(a => a.roles?.code === 'agent'),
    [refs.agents]
  )

  // إضافة coordinator_id للفلتر لو "اتحوّلولي اليوم" مفعّل ودور المستخدم منسقة
  const effectiveFilters = useMemo(() => {
    const f = { ...filters, search: debouncedSearch }
    if (f.transferredToday && roleCode === 'coordinator') f.coordinatorId = profile.id
    // حصر نطاق عدّ الأعمدة لِما يراه المستخدم فعلًا (v_lead_flags يتخطّى الـ RLS)
    if (!isManager) {
      if (roleCode === 'agent') f.mineOwner = profile.id
      else if (roleCode === 'coordinator') f.mineCoordinator = profile.id
    }
    return f
  }, [filters, debouncedSearch, roleCode, profile, isManager])

  // quiet = تحديث هادئ بلا شاشة تحميل (الصفوف الحالية تبقى ظاهرة حتى تصل الجديدة)
  const loadTable = useCallback(async ({ quiet = false } = {}) => {
    if (!boardStageIds.length) return
    if (!quiet) setLoading(true)
    // نجلب صفحة أكبر قليلاً لو فيه فلاتر محلية، لضمان امتلاء الصفحة
    const { rows, total } = await fetchLeadsPage({
      boardStageIds, filters: effectiveFilters, page, pageSize,
    })
    setTableRows(rows)
    setTotal(total)
    setLoading(false)
  }, [boardStageIds, effectiveFilters, page, pageSize, refreshKey])

  useEffect(() => { if (view === 'table') loadTable() }, [loadTable, view])

  // نسخة حيّة من loadTable لاستدعاء تحديث هادئ من الدرور دون إعادة إنشاء أي مستمع
  const loadTableRef = useRef(loadTable)
  useEffect(() => { loadTableRef.current = loadTable }, [loadTable])

  // أعداد الشرائح — نداء RPC واحد يحسب السبعة على البورد كاملًا،
  // والصلاحية تُشتق داخل القاعدة من المستخدم (لا من الواجهة).
  // مستقلّة عن الفلاتر النشطة، فتُحسب مرة عند تغيّر البورد فقط.
  useEffect(() => {
    if (!boardStageIds.length) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('chip_counts', { p_stage_ids: boardStageIds })
      if (cancelled) return
      if (error) { console.error(error); return }
      const c = data?.[0] ?? {}
      setChipCounts({
        alertOnly:   c.alert_only   ?? 0,
        taskToday:   c.task_today   ?? 0,
        taskOverdue: c.task_overdue ?? 0,
        noTask:      c.no_task      ?? 0,
        paused:      c.paused       ?? 0,
        noOwner:     c.no_owner     ?? 0,
        stale:       c.stale        ?? 0,
      })
    })()
    return () => { cancelled = true }
  }, [boardStageIds])
  useEffect(() => { setPage(0) }, [filters, board, pageSize])
  // التحديد يخصّ الصفحة المعروضة — يُمسح عند أي تغيير في السياق
  useEffect(() => { setSelected(new Set()) }, [filters, board, pageSize, page, view, refreshKey])

  // فتح ليد مع حفظ سياقه للتنقّل بالأسهم
  const openLeadWith = useCallback((lead, list) => {
    setNavList(Array.isArray(list) ? list : [])
    setOpenLead(lead)
  }, [])

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const toggle = (k) => setFilters(f => ({ ...f, [k]: !f[k] }))
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // refresh جماعي كامل — لإضافة ليد جديد والإجراءات الجماعية والاسترجاع فقط
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // تغييرات الدرور:
  //  • الكانبان → تحديث موضعي عبر boardBus (بلا نداء قاعدة للنقل)
  //  • الجدول → تحديث هادئ للصفوف بلا شاشة تحميل تقطع على السيلز مع النت البطيء
  const onDrawerChanged = useCallback(() => {
    if (view === 'table') loadTableRef.current({ quiet: true })
  }, [view])

  const toggleOne = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAllOnPage = useCallback((on) => {
    setSelected(prev => {
      const next = new Set(prev)
      tableRows.forEach(l => on ? next.add(l.id) : next.delete(l.id))
      return next
    })
  }, [tableRows])

  // الشرائح السريعة (تختلف قليلاً حسب الدور)
  const CHIPS = [
    ...(roleCode === 'coordinator'
      ? [{ key: 'transferredToday', label: 'اتحوّلولي اليوم' }]
      : []),
    { key: 'alertOnly',   label: '🔴 علامة حمراء' },
    { key: 'taskToday',   label: 'تاسك اليوم' },
    { key: 'taskOverdue', label: 'تاسك متأخر' },
    { key: 'paused',      label: 'موقوفة المتابعة' },
    ...(isManager ? [{ key: 'noOwner', label: 'بدون مسؤول' }] : []),
    { key: 'stale',       label: 'راكدة (٧ أيام)' },
    { key: 'noTask',      label: 'بدون تاسك' },
  ]

  const loadArchive = useCallback(async () => {
    setLoadingArch(true)
    const { data } = await supabase
      .from('leads')
      .select('id, file_no, full_name, phone, archived_at, stages(name_ar), owner:profiles!leads_owner_id_fkey(full_name)')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(200)
    setArchived(data ?? [])
    setLoadingArch(false)
  }, [])

  useEffect(() => { if (showArchive) loadArchive() }, [showArchive, loadArchive, refreshKey])

  async function restore(id) {
    await supabase.rpc('unarchive_lead', { p_lead_id: id })
    loadArchive(); refresh()
  }

  const advancedCount = ['createdFrom','createdTo','branch','interest','priceFrom','priceTo','ageFrom','ageTo','movedToday','snoozed',
    'movedFrom','movedTo','callsFrom','callsTo','callsMin','callsMax','callsAnswered']
    .filter(k => filters[k]).length

  // كل الفلاتر النشطة — لتوضيح أن العدد المعروض مفلتَر
  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => v !== '' && v !== false && v != null).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الليدات</h1>
          <div className="hint">
            {board === 'sales'
              ? 'بورد المبيعات'
              : (roleCode === 'agent' ? 'مرضاك المحوّلون — للمتابعة فقط' : 'بورد المنسقات')}
            {view === 'table' && (
              <> — <b style={{ color: 'var(--gold)' }}>{total.toLocaleString('en-US')}</b> ليد
                {activeFilterCount > 0 && ' (بعد الفلترة)'}
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isManager && (
            <button className="btn btn-ghost" onClick={() => setShowExport(true)}>
              ⬇ تصدير إكسيل
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ ليد جديد</button>
        </div>
      </div>

      <div className="board-tabs">
        <button className={board === 'sales' ? 'on' : ''}
          onClick={() => { setBoard('sales'); setShowArchive(false); set('coordinator', '') }}>
          بورد المبيعات
        </button>
        <button className={board === 'coordinator' ? 'on' : ''}
          onClick={() => { setBoard('coordinator'); setShowArchive(false) }}>
          {roleCode === 'agent' ? 'مرضاي عند المنسقات' : 'بورد المنسقات'}
        </button>
        {isManager && (
          <button className={showArchive ? 'on' : ''} onClick={() => setShowArchive(true)}>
            📦 الأرشيف
          </button>
        )}
      </div>

      {/* الشرائح السريعة */}
      <div className="quick-chips">
        {CHIPS.map(c => (
          <button key={c.key}
            className={'chip' + (filters[c.key] ? ' on' : '')}
            onClick={() => toggle(c.key)}>
            {c.label}
            {chipCounts[c.key] !== undefined && (
              <span className="chip-count">{chipCounts[c.key].toLocaleString('en-US')}</span>
            )}
          </button>
        ))}
      </div>

      <div className="card filters-bar">
        <input
          className="filter-search"
          placeholder="بحث بالاسم أو الهاتف أو رقم الملف…"
          value={filters.search}
          onChange={e => set('search', e.target.value)}
        />
        <select value={filters.stage} onChange={e => set('stage', e.target.value)}>
          <option value="">كل مراحل البورد</option>
          {boardStages.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
        </select>
        <select value={filters.source} onChange={e => set('source', e.target.value)}>
          <option value="">كل المصادر</option>
          {refs.sources.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
        </select>
        {/* فلاتر الأشخاص — متاحة للجميع، وRLS يحدّ ما يراه كل دور
            السيلز يحتاج معرفة مرضاه عند أي منسقة،
            والمنسقة تحتاج معرفة مصدر مرضاها من المبيعات */}
        {board === 'sales' && isManager && (
          <select value={filters.owner} onChange={e => set('owner', e.target.value)}>
            <option value="">كل موظفي المبيعات</option>
            {salesAgents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        )}

        {board === 'coordinator' && (
          <>
            <select value={filters.coordinator} onChange={e => set('coordinator', e.target.value)}
              title={roleCode === 'agent'
                ? 'شاهد مرضاك عند منسقة بعينها'
                : 'فلترة حسب المنسقة المسؤولة'}>
              <option value="">
                {roleCode === 'agent' ? 'مرضاي عند كل المنسقات' : 'كل المنسقات'}
              </option>
              {(refs.coordinators ?? []).map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>

            {(isManager || roleCode === 'coordinator') && (
              <select value={filters.owner} onChange={e => set('owner', e.target.value)}>
                <option value="">كل موظفي المبيعات</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            )}
          </>
        )}

        <button className={'btn btn-ghost' + (advancedCount ? ' on' : '')}
          onClick={() => setShowMore(s => !s)}>
          فلاتر أكثر{advancedCount ? ` (${advancedCount})` : ''}
        </button>
        {view === 'kanban' && (
          <select value={sort} onChange={e => setSort(e.target.value)}
            title="ترتيب الليدات داخل كل عمود">
            <option value="recent">الأحدث نشاطًا</option>
            <option value="oldest">الأقدم — المهملون أولًا</option>
          </select>
        )}
        <div className="view-toggle">
          <button className={view === 'kanban' ? 'on' : ''} onClick={() => setView('kanban')}>كانبان</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>جدول</button>
        </div>
      </div>

      {/* اللوحة التفصيلية */}
      {showMore && (
        <div className="card advanced-filters">
          <div className="af-grid">
            <div className="field">
              <label>تاريخ الإنشاء من</label>
              <input type="date" value={filters.createdFrom} onChange={e => set('createdFrom', e.target.value)} />
            </div>
            <div className="field">
              <label>إلى</label>
              <input type="date" value={filters.createdTo} onChange={e => set('createdTo', e.target.value)} />
            </div>
            <div className="field">
              <label>الفرع</label>
              <select value={filters.branch} onChange={e => set('branch', e.target.value)}>
                <option value="">كل الفروع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>الاهتمام</label>
              <select value={filters.interest} onChange={e => set('interest', e.target.value)}>
                <option value="">الكل</option>
                <option value="hair">زراعة شعر</option>
                <option value="beard">لحية</option>
                <option value="eyebrows">حواجب</option>
                <option value="prp">بلازما</option>
              </select>
            </div>
            <div className="field">
              <label>السعر من</label>
              <input type="number" value={filters.priceFrom} onChange={e => set('priceFrom', e.target.value)} />
            </div>
            <div className="field">
              <label>السعر إلى</label>
              <input type="number" value={filters.priceTo} onChange={e => set('priceTo', e.target.value)} />
            </div>
            <div className="field">
              <label>العمر من</label>
              <input type="number" value={filters.ageFrom} onChange={e => set('ageFrom', e.target.value)} />
            </div>
            <div className="field">
              <label>العمر إلى</label>
              <input type="number" value={filters.ageTo} onChange={e => set('ageTo', e.target.value)} />
            </div>
          </div>
          {/* الحركة والمكالمات خلال فترة */}
          <div className="af-grid" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <div className="field">
              <label>اتحرّك من</label>
              <input type="date" value={filters.movedFrom} onChange={e => set('movedFrom', e.target.value)} />
            </div>
            <div className="field">
              <label>اتحرّك إلى</label>
              <input type="date" value={filters.movedTo} onChange={e => set('movedTo', e.target.value)} />
            </div>
            <div className="field">
              <label>مكالمات السنترال من تاريخ</label>
              <input type="date" value={filters.callsFrom} onChange={e => set('callsFrom', e.target.value)} />
            </div>
            <div className="field">
              <label>إلى تاريخ</label>
              <input type="date" value={filters.callsTo} onChange={e => set('callsTo', e.target.value)} />
            </div>
            <div className="field">
              <label>عدد المكالمات من</label>
              <input type="number" min="0" placeholder="0" value={filters.callsMin}
                onChange={e => set('callsMin', e.target.value)} />
            </div>
            <div className="field">
              <label>عدد المكالمات إلى</label>
              <input type="number" min="0" placeholder="بلا حد" value={filters.callsMax}
                onChange={e => set('callsMax', e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
            «اتحرّك» = أي نشاط في السجل أو مكالمة سنترال في الفترة. «عدد المكالمات» من مكالمات Azeer —
            اكتب 0 في الاتنين عشان تطلع الليدز اللي محدش كلّمها في الفترة.
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
              <input type="checkbox" checked={filters.callsAnswered}
                onChange={e => set('callsAnswered', e.target.checked)} style={{ width: 16, height: 16 }} />
              المكالمات اللي اتردّ عليها بس
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
              <input type="checkbox" checked={filters.movedToday}
                onChange={e => set('movedToday', e.target.checked)} style={{ width: 16, height: 16 }} />
              اتحرّك النهاردة
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
              <input type="checkbox" checked={filters.snoozed}
                onChange={e => set('snoozed', e.target.checked)} style={{ width: 16, height: 16 }} />
              مؤجّلة لبكرة
            </label>
            <button className="btn btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>مسح كل الفلاتر</button>
          </div>
        </div>
      )}

      {showArchive ? (
        <div className="card">
          {loadingArch ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : archived.length === 0 ? (
            <div className="empty"><strong>الأرشيف فارغ</strong>لا ليدات مؤرشفة</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>الملف</th><th>العميل</th><th>الهاتف</th><th>آخر مرحلة</th><th>المسؤول</th><th>تاريخ الأرشفة</th><th></th></tr>
              </thead>
              <tbody>
                {archived.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{l.file_no}</td>
                    <td style={{ fontWeight: 600 }}>{l.full_name}</td>
                    <td>
                      <div className="phone-cell">
                        <span dir="ltr">{l.phone ?? '—'}</span>
                        {l.phone && (
                          <button className="icon-btn" title="نسخ الرقم"
                            onClick={() => navigator.clipboard?.writeText(l.phone)}>⧉</button>
                        )}
                      </div>
                    </td>
                    <td>{l.stages?.name_ar ?? '—'}</td>
                    <td>{l.owner?.full_name ?? '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                      {new Date(l.archived_at).toLocaleDateString('ar-EG-u-nu-latn')}
                    </td>
                    <td>
                      <button className="btn btn-primary" onClick={() => restore(l.id)}>استرجاع</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : view === 'kanban' ? (
        <Kanban
          key={board + '-' + sort + '-' + JSON.stringify(effectiveFilters)}
          refreshKey={refreshKey}
          board={board}
          stages={boardStages}
          filters={effectiveFilters}
          sort={sort}
          onOpen={openLeadWith}
        />
      ) : (
        <>
          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : tableRows.length === 0 ? (
            <div className="card empty"><strong>لا نتائج مطابقة</strong>جرّب تعديل الفلاتر</div>
          ) : (
            <>
              {isManager && selected.size > 0 && (
                <BulkActionsBar
                  ids={[...selected]}
                  stages={refs.stages}
                  agents={refs.agents}
                  onClear={() => setSelected(new Set())}
                  onDone={() => { setSelected(new Set()); refresh() }}
                />
              )}
              <LeadsTable
                leads={tableRows}
                onOpen={openLeadWith}
                selectable={isManager}
                selected={selected}
                onToggle={toggleOne}
                onToggleAll={toggleAllOnPage}
              />
            </>
          )}

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
                  صفحة {(page + 1).toLocaleString('en-US')} من {totalPages.toLocaleString('en-US')}
                </span>
                <button className="btn btn-ghost" disabled={page + 1 >= totalPages}
                  onClick={() => setPage(p => p + 1)}>التالي →</button>
              </>
            )}
          </div>
        </>
      )}

      {showExport && (
        <ExportLeadsModal
          boardStageIds={boardStageIds}
          board={board}
          filters={effectiveFilters}
          onClose={() => setShowExport(false)}
        />
      )}
      {showAdd && (
        <AddLeadModal refs={refs} onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh() }} />
      )}
      {openLead && (
        <LeadDrawer leadId={openLead.id} refs={refs}
          siblings={navList}
          onNavigate={setOpenLead}
          onClose={() => setOpenLead(null)} onChanged={onDrawerChanged} />
      )}
    </>
  )
}
