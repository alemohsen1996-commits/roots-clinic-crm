// صفحة الديلات — القائمة + فلاتر الحالة + بطاقة موافقات الخصم للمديرين
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { salesLabel } from '../lib/people'
import { useDealRefs, fetchDeals, DEAL_STATUS } from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'
import NewDealModal from './NewDealModal'
import DealDrawer from './DealDrawer'

export default function DealsPage() {
  const { isManager, profile } = useAuth()
  const refs = useDealRefs()
  const [params, setParams] = useSearchParams()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')
  const [coordId, setCoordId] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  // البحث بـ debounce — الاستعلام يستنى توقف الكتابة 300ms
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])
  const [showNew, setShowNew] = useState(false)
  const [openDeal, setOpenDeal] = useState(null)

  // لو جاي من شاشة الليدات بعد نقل ليد للديل: ?lead=ID يفتح نموذج التعاقد جاهزًا
  const preloadLead = params.get('lead')

  const load = useCallback(async () => {
    setLoading(true)
    const { rows, total } = await fetchDeals({
      status, agent: agentId, coordinator: coordId, search: debounced, page, pageSize,
    })
    setDeals(rows)
    setTotal(total)
    setLoading(false)
  }, [status, agentId, coordId, debounced, page, pageSize])

  useEffect(() => { load() }, [load])
  // أي تغيير في الفلاتر يرجّع لأول صفحة
  useEffect(() => { setPage(0) }, [status, agentId, coordId, debounced, pageSize])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (preloadLead) setShowNew(true) }, [preloadLead])

  const visible = deals

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الديلات</h1>
          <div className="hint">{total.toLocaleString('en-US')} تعاقد</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ ديل جديد</button>
      </div>

      <div className="card filters-bar">
        <input className="filter-search" placeholder="بحث بالاسم أو الهاتف أو رقم الملف…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="done">تمت العملية</option>
          <option value="waiting">انتظار</option>
          <option value="lost">خسارة</option>
        </select>

        {/* فلاتر الأشخاص — تُمكّن المنسقة والمحاسب والمدير من التمييز */}
        <select value={agentId} onChange={e => setAgentId(e.target.value)}>
          <option value="">كل موظفي المبيعات</option>
          {(refs.agents ?? []).some(a => a.id === profile?.id) && <option value={profile.id}>ديلاتي</option>}
          {(refs.agents ?? []).filter(a => a.id !== profile?.id)
            .map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
        </select>

        <select value={coordId} onChange={e => setCoordId(e.target.value)}>
          <option value="">كل المنسقات</option>
          {refs.coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>

        {(status || agentId || coordId || search) && (
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setStatus(''); setAgentId(''); setCoordId(''); setSearch('') }}>
            مسح الفلاتر
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : visible.length === 0 ? (
        <div className="card empty">
          <strong>لا توجد ديلات</strong>
          انقل عميلًا إلى مرحلة الديل ثم افتح له ملف تعاقد من هنا
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' /* تمرير أفقي بس — من غير سقف للارتفاع */ }}>
          <table className="table">
            <thead>
              <tr>
                <th>الملف</th><th>العميل</th><th>الهاتف</th><th>العملية</th><th>النوع</th><th>التقنية</th><th>البصيلات</th>
                <th>الصافي</th><th>السيلز</th><th>المنسقة</th><th>العملية</th><th>الحالة</th><th>الضريبة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(d => (
                <tr key={d.id} onClick={() => setOpenDeal(d)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{d.leads?.file_no}</td>
                  <td style={{ fontWeight: 600 }}>{d.leads?.full_name}</td>
                  <td dir="ltr" style={{ fontSize: 12.5, whiteSpace: 'nowrap', textAlign: 'right' }}>{d.leads?.phone ?? '—'}</td>
                  <td>
                    {d.procedure_no > 1
                      ? <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                          عملية {d.procedure_no}
                        </span>
                      : <span style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>الأولى</span>}
                  </td>
                  <td>{d.procedure_types?.name_ar ?? '—'}</td>
                  <td style={{ fontSize: 12.5 }}>{d.techniques?.name ?? '—'}</td>
                  <td>{d.grafts ? fmtNum(d.grafts) : '—'}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(d.net_amount)} ر.س</td>
                  <td style={{ fontSize: 12.5 }}>{d.agent?.full_name ?? '—'}</td>
                  <td>{d.coordinator?.full_name ?? <span style={{ color: 'var(--danger)' }}>لم تُحدد</span>}</td>
                  <td>{fmtDate(d.operation_date)}</td>
                  <td>
                    <span className={'badge ' + DEAL_STATUS[d.status]?.cls}>
                      {DEAL_STATUS[d.status]?.label}
                    </span>
                    {d.is_locked && ' 🔒'}
                  </td>
                  <td>{Number(d.tax_amount) > 0 ? fmtNum(d.tax_amount) + ' ر.س' : '—'}</td>
                </tr>
              ))}
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
                صفحة {(page + 1).toLocaleString('en-US')} من {totalPages.toLocaleString('en-US')}
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
          onSaved={() => { setShowNew(false); if (preloadLead) setParams({}); load() }}
        />
      )}

      {openDeal && (
        <DealDrawer
          dealId={openDeal.id}
          refs={refs}
          onClose={() => setOpenDeal(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
