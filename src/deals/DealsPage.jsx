// صفحة الديلات — القائمة + فلاتر الحالة + بطاقة موافقات الخصم للمديرين
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDealRefs, fetchDeals, DEAL_STATUS } from './useDealRefs'
import { fmtNum, fmtDate } from '../lib/format'
import NewDealModal from './NewDealModal'
import DealDrawer from './DealDrawer'

export default function DealsPage() {
  const { isManager } = useAuth()
  const refs = useDealRefs()
  const [params, setParams] = useSearchParams()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [openDeal, setOpenDeal] = useState(null)

  // لو جاي من شاشة الليدات بعد نقل ليد للديل: ?lead=ID يفتح نموذج التعاقد جاهزًا
  const preloadLead = params.get('lead')

  const load = useCallback(async () => {
    setLoading(true)
    setDeals(await fetchDeals({ status }))
    setLoading(false)
  }, [status])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (preloadLead) setShowNew(true) }, [preloadLead])

  const visible = deals.filter(d => {
    if (!search.trim()) return true
    const s = search.trim()
    return d.leads?.full_name?.includes(s)
        || d.leads?.phone?.includes(s)
        || d.leads?.file_no?.includes(s)
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الديلات</h1>
          <div className="hint">{visible.length} تعاقد</div>
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
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : visible.length === 0 ? (
        <div className="card empty">
          <strong>لا توجد ديلات</strong>
          انقل عميلًا إلى مرحلة الديل ثم افتح له ملف تعاقد من هنا
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>الملف</th><th>العميل</th><th>العملية</th><th>النوع</th><th>البصيلات</th>
                <th>الصافي</th><th>المنسقة</th><th>العملية</th><th>الحالة</th><th>الضريبة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(d => (
                <tr key={d.id} onClick={() => setOpenDeal(d)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{d.leads?.file_no}</td>
                  <td style={{ fontWeight: 600 }}>{d.leads?.full_name}</td>
                  <td>
                    {d.procedure_no > 1
                      ? <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                          عملية {d.procedure_no}
                        </span>
                      : <span style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>الأولى</span>}
                  </td>
                  <td>{d.procedure_types?.name_ar ?? '—'}</td>
                  <td>{d.grafts ? fmtNum(d.grafts) : '—'}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtNum(d.net_amount)} ر.س</td>
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
