// جرس الإشعارات — زرار (في السايدبار على الكمبيوتر وفي الشريط العلوي على الموبايل)
// + لوحة الإشعارات + فتح الليد/الديل/الباقة مباشرة فوق أي صفحة
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import i18n from '../i18n'
import useT from '../i18n/useT'
import { fmtNum, cur, timeAgo, fmtDate, fmtClock } from '../lib/format'
import { useLeadRefs } from '../leads/useLeadRefs'
import { useDealRefs } from '../deals/useDealRefs'
import LeadDrawer from '../leads/LeadDrawer'
import DealDrawer from '../deals/DealDrawer'
import PrpDrawer from '../prp/PrpDrawer'

// ---------- النص: من الترجمة لو عندنا بيانات، وإلا النص المخزّن (إشعارات قديمة) ----------
function notifText(n) {
  const d = n.data ?? {}
  const hasData = Object.keys(d).length > 0
  if (!hasData || !i18n.exists(`notif.t.${n.type}`)) return { title: n.title, body: n.body }

  const t = (k, o) => i18n.t(k, o)
  const who = [d.name, d.file_no].filter(Boolean).join(' · ')
  switch (n.type) {
    case 'lead_assigned':
      return n.group_count > 1
        ? { title: t('notif.t.lead_assigned_many', { count: n.group_count }), body: t('notif.b.openLeads') }
        : { title: t('notif.t.lead_assigned'), body: who }
    case 'void_requested':
    case 'void_approved':
    case 'void_rejected':
      return { title: t(`notif.t.${n.type}`), body: [d.name, d.amount != null && `${fmtNum(d.amount)} ${cur()}`].filter(Boolean).join(' · ') }
    case 'tasks_digest':
      return { title: t('notif.t.tasks_digest'), body: t('notif.b.tasks', { today: d.today ?? 0, overdue: d.overdue ?? 0 }) }
    case 'deal_outcome_due':
      return { title: t('notif.t.deal_outcome_due'), body: [d.name, d.date && t('notif.b.opDate', { date: fmtDate(d.date) })].filter(Boolean).join(' · ') }
    case 'prp_due':
      return { title: t('notif.t.prp_due'), body: [d.name, d.session_no && t('notif.b.session', { n: d.session_no })].filter(Boolean).join(' · ') }
    case 'appt_tomorrow':
      return { title: t('notif.t.appt_tomorrow'), body: [d.name, d.time && fmtClock(d.time), d.branch].filter(Boolean).join(' · ') }
    default:
      return { title: t(`notif.t.${n.type}`), body: who }
  }
}

// ---------- الأيقونة حسب نوع الإشعار ----------
const KIND = {
  lead_assigned: 'lead', lead_returned: 'lead', lead_transferred: 'coord',
  void_requested: 'money', void_approved: 'money', void_rejected: 'money',
  tasks_digest: 'clock', deal_outcome_due: 'flag', prp_due: 'clock', appt_tomorrow: 'cal',
}
const GLYPH = {
  lead:  <><circle cx="10" cy="8" r="3.5"/><path d="M4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M18 8h4M20 6v4"/></>,
  coord: <><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5"/><path d="M15 12h6M18.5 9.5 21 12l-2.5 2.5"/></>,
  money: <><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19M6.5 15h4"/></>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
  flag:  <><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></>,
  cal:   <><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.6 1.6 6.4 2.3 7.1.2.2.1.6-.2.6H3.9c-.3 0-.4-.4-.2-.6C4.4 15.9 6 14.1 6 9.5z"/>
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>
  </svg>
)

// ---------- الزرار ----------
export function BellButton({ unread, open, onToggle, className = '' }) {
  const { t } = useT()
  const label = unread > 0 ? t('notif.bellUnread', { n: unread }) : t('notif.bell')
  return (
    <button type="button" className={'bell-btn ' + className} onClick={onToggle}
      aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog">
      <BellIcon />
      {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
  )
}

// ---------- اللوحة ----------
// تجميع حسب اليوم: النهارده / امبارح / التاريخ
function dayKey(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  return x.getTime()
}
function dayLabel(key) {
  const today = dayKey(Date.now())
  if (key === today) return i18n.t('notif.today')
  if (key === today - 86400000) return i18n.t('notif.yesterday')
  return fmtDate(key)
}
function groupByDay(items) {
  const out = []
  for (const n of items) {
    const k = dayKey(n.updated_at ?? n.created_at)
    const last = out[out.length - 1]
    if (last && last.key === k) last.items.push(n)
    else out.push({ key: k, items: [n] })
  }
  return out
}

const XIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
)

export function NotificationPanel({ notif, onClose, onPick }) {
  const { t } = useT()
  const { items, unread, total, filter, hasMore, loading,
          setFilter, loadMore, markAllRead, remove, clearAll } = notif

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirmClear() {
    if (window.confirm(t('notif.clearAllConfirm', { n: total }))) clearAll()
  }

  const groups = groupByDay(items)

  return (
    <>
      <div className="notif-scrim" onClick={onClose} />
      <section className="notif-panel" role="dialog" aria-label={t('notif.title')}>
        <header className="notif-head">
          <h2>{t('notif.title')}</h2>
          <div className="notif-actions">
            {unread > 0 && (
              <button type="button" className="notif-link" onClick={markAllRead}>{t('notif.markAll')}</button>
            )}
            {total > 0 && (
              <button type="button" className="notif-link danger" onClick={confirmClear}>{t('notif.clearAll')}</button>
            )}
          </div>
        </header>

        <div className="notif-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={filter === 'all'}
            className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            {t('notif.tabAll')} <span>{total.toLocaleString('en-US')}</span>
          </button>
          <button type="button" role="tab" aria-selected={filter === 'unread'}
            className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>
            {t('notif.tabUnread')} <span>{unread.toLocaleString('en-US')}</span>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="notif-empty">
            {loading ? <span>{t('common.loading')}</span> : filter === 'unread' ? (
              <>
                <strong>{t('notif.emptyUnreadTitle')}</strong>
                <span>{t('notif.emptyUnreadBody')}</span>
              </>
            ) : (
              <>
                <strong>{t('notif.emptyTitle')}</strong>
                <span>{t('notif.emptyBody')}</span>
              </>
            )}
          </div>
        ) : (
          <div className="notif-scroll">
            {groups.map(g => (
              <div key={g.key} className="notif-day">
                <div className="notif-day-label">{dayLabel(g.key)}</div>
                <ul className="notif-list">
                  {g.items.map(n => {
                    const { title, body } = notifText(n)
                    const kind = KIND[n.type] ?? 'lead'
                    return (
                      <li key={n.id} className={'notif-row' + (n.is_read ? '' : ' unread')}>
                        <button type="button" className="notif-item" onClick={() => onPick(n)}>
                          <span className={'notif-ico k-' + kind}>
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPH[kind]}</svg>
                          </span>
                          <span className="notif-text">
                            <span className="notif-title">{title}</span>
                            {body && <span className="notif-body">{body}</span>}
                            <span className="notif-time">{timeAgo(n.updated_at ?? n.created_at)}</span>
                          </span>
                        </button>
                        <button type="button" className="notif-del" onClick={() => remove(n.id)}
                          aria-label={t('notif.delete')} title={t('notif.delete')}>
                          <XIcon />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}

            {hasMore && (
              <button type="button" className="notif-more" onClick={loadMore} disabled={loading}>
                {loading ? t('common.loading') : t('notif.loadMore')}
              </button>
            )}
          </div>
        )}
      </section>
    </>
  )
}

// ---------- فتح الهدف فوق الصفحة الحالية ----------
function LeadOpener({ id, onClose }) {
  const refs = useLeadRefs()
  if (!refs.ready) return null
  return <LeadDrawer leadId={id} refs={refs} onClose={onClose} onChanged={() => {}} />
}
function DealOpener({ id, onClose }) {
  const refs = useDealRefs()
  if (!refs.ready) return null
  return <DealDrawer dealId={id} refs={refs} onClose={onClose} onChanged={() => {}} />
}

export function EntityOpener({ target, onClose }) {
  if (!target) return null
  if (target.kind === 'lead') return <LeadOpener id={target.id} onClose={onClose} />
  if (target.kind === 'deal') return <DealOpener id={target.id} onClose={onClose} />
  if (target.kind === 'prp')  return <PrpDrawer packageId={target.id} onClose={onClose} onChanged={() => {}} />
  return null
}

// الإشعار → إيه اللي يتفتح: لوحة جانبية (target) أو صفحة (path)
export function useNotifTarget() {
  const navigate = useNavigate()
  return (n) => {
    const id = n.entity_id ? Number(n.entity_id) : null
    switch (n.entity) {
      case 'leads':      return id ? { kind: 'lead', id } : (navigate('/leads'), null)
      case 'deals':      return id ? { kind: 'deal', id } : (navigate('/deals'), null)
      case 'prp':        return id ? { kind: 'prp', id } : (navigate('/prp'), null)
      case 'payments':   navigate('/payments'); return null
      case 'tasks':      navigate('/tasks'); return null
      case 'leads_list': navigate('/leads'); return null
      default:           return null
    }
  }
}
