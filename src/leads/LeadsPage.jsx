// صفحة الليدات — شرائح فلترة سريعة + لوحة تفصيلية + بوردان + جدول مقسّم
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLeadRefs, fetchLeadsPage, computeAlert, applyLocalFilters } from './useLeadRefs'
import Kanban from './Kanban'
import LeadsTable from './LeadsTable'
import AddLeadModal from './AddLeadModal'
import LeadDrawer from './LeadDrawer'
import ExportLeadsModal from './ExportLeadsModal'
import BulkActionsBar from './BulkActionsBar'
import { supabase } from '../lib/supabase'

const EMPTY_FILTERS = {
  search: '', stage: '', source: '', owner: '', branch: '', interest: '',
  createdFrom: '', createdTo: '',
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
  const [view, setView] = useState('kanban')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showAdd, setShowAdd] = useState(false)
  const [openLead, setOpenLead] = useState(null)
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

  // إضافة coordinator_id للفلتر لو "اتحوّلولي اليوم" مفعّل ودور المستخدم منسقة
  const effectiveFilters = useMemo(() => {
    const f = { ...filters }
    if (f.transferredToday && roleCode === 'coordinator') f.coordinatorId = profile.id
    return f
  }, [filters, roleCode, profile])

  const loadTable = useCallback(async () => {
    if (!boardStageIds.length) return
    setLoading(true)
    // نجلب صفحة أكبر قليلاً لو فيه فلاتر محلية، لضمان امتلاء الصفحة
    const { rows, total } = await fetchLeadsPage({
      boardStageIds, filters: effectiveFilters, page, pageSize,
    })
    const finalRows = applyLocalFilters(rows, effectiveFilters)
    setTableRows(finalRows)
    setTotal(total)
    setLoading(false)
  }, [boardStageIds, effectiveFilters, page, pageSize, refreshKey])

  useEffect(() => { if (view === 'table') loadTable() }, [loadTable, view])
  useEffect(() => { setPage(0) }, [filters, board, pageSize])
  // التحديد يخصّ الصفحة المعروضة — يُمسح عند أي تغيير في السياق
  useEffect(() => { setSelected(new Set()) }, [filters, board, pageSize, page, view, refreshKey])

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const toggle = (k) => setFilters(f => ({ ...f, [k]: !f[k] }))
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

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

  const advancedCount = ['createdFrom','createdTo','branch','interest','priceFrom','priceTo','ageFrom','ageTo','movedToday','snoozed']
    .filter(k => filters[k]).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الليدات</h1>
          <div className="hint">
            {board === 'sales'
              ? 'بورد المبيعات'
              : (roleCode === 'agent' ? 'مرضاك المحوّلون — للمتابعة فقط' : 'بورد المنسقات')}
            {view === 'table' && ` — ${(view === 'table' ? tableRows.length : total).toLocaleString('ar-EG')} ظاهر`}
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
          onClick={() => { setBoard('sales'); setShowArchive(false) }}>
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
        {isManager && (
          <select value={filters.owner} onChange={e => set('owner', e.target.value)}>
            <option value="">كل الموظفين</option>
            {refs.agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        )}
        <button className={'btn btn-ghost' + (advancedCount ? ' on' : '')}
          onClick={() => setShowMore(s => !s)}>
          فلاتر أكثر{advancedCount ? ` (${advancedCount})` : ''}
        </button>
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
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
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
                      {new Date(l.archived_at).toLocaleDateString('ar-EG')}
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
          key={board + '-' + refreshKey + '-' + JSON.stringify(effectiveFilters)}
          board={board}
          stages={boardStages}
          filters={effectiveFilters}
          onOpen={setOpenLead}
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
                onOpen={setOpenLead}
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
                  صفحة {(page + 1).toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}
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
          onClose={() => setOpenLead(null)} onChanged={refresh} />
      )}
    </>
  )
}
