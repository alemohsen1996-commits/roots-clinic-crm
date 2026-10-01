// الشات الداخلي بين الموظفين
// • «محادثاتي»: محادثات الموظف الفردية والجروبات
// • «المراقبة» (المدير العام + مدير المبيعات): كل محادثات الموظفين قراءة فقط،
//   مع النص الأصلي لأي رسالة اتعدلت أو اتمسحت — وفتح المحادثة بيتسجل
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fmtDate } from '../lib/format'
import LeadDrawer from '../leads/LeadDrawer'
import { useLeadRefs } from '../leads/useLeadRefs'
import {
  PAGE, convName, deleteMessage, editMessage, errText, fetchConversation, fetchEmployees,
  fetchHistory, fetchInbox, fetchMessage, fetchMessages, fetchMonitorList, fetchParticipants,
  logMonitorView, markRead, newMsgId, sendMessage,
} from './chatApi'
import { onChat, watchingConv } from './chatRealtime'
import NewChatModal from './NewChatModal'
import GroupInfoModal from './GroupInfoModal'
import LeadPicker from './LeadPicker'
import PushToggle from './PushToggle'
import './chat.css'

const LOC = 'ar-EG-u-nu-latn'
const fmtTime = (d) => new Date(d).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })
const dayKey = (d) => new Date(d).toDateString()
function dayLabel(d) {
  const x = new Date(d), today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (x.toDateString() === today.toDateString()) return 'اليوم'
  if (x.toDateString() === y.toDateString()) return 'أمس'
  return fmtDate(d)
}
function listTime(d) {
  if (!d) return ''
  return new Date(d).toDateString() === new Date().toDateString() ? fmtTime(d)
    : new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'short' })
}
const canEditMsg = (m) => Date.now() - new Date(m.created_at).getTime() < 24 * 3600 * 1000
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches

export default function ChatPage() {
  const { profile, roleCode } = useAuth()
  const meId = profile.id
  const canMonitor = roleCode === 'super_admin' || roleCode === 'sales_manager'
  const canGroup = canMonitor
  const refs = useLeadRefs()

  const [params, setParams] = useSearchParams()
  const activeId = params.get('c')
  const openConv = (id) => setParams(id ? { c: id } : {})

  const [tab, setTab] = useState('mine')
  const [inbox, setInbox] = useState([])
  const [monitor, setMonitor] = useState([])
  const [monUser, setMonUser] = useState('')
  const [monSearch, setMonSearch] = useState('')
  const [employees, setEmployees] = useState([])
  const [filter, setFilter] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [leadOpen, setLeadOpen] = useState(null)

  // ---------- القوائم ----------
  const loadInbox = useCallback(async () => {
    try { setInbox(await fetchInbox()) } catch (e) { console.error(e) }
    setListLoading(false)
  }, [])

  const loadMonitor = useCallback(async () => {
    if (!canMonitor) return
    try {
      const rows = await fetchMonitorList({ userId: monUser || null, search: monSearch })
      setMonitor(rows.filter(r => !(r.members ?? []).some(m => m.id === meId)))
    } catch (e) { console.error(e) }
  }, [canMonitor, monUser, monSearch, meId])

  useEffect(() => { loadInbox() }, [loadInbox])
  useEffect(() => {
    if (tab !== 'monitor') return
    const t = setTimeout(loadMonitor, 300)
    return () => clearTimeout(t)
  }, [tab, loadMonitor])
  useEffect(() => { if (canMonitor) fetchEmployees().then(setEmployees).catch(() => {}) }, [canMonitor])

  // ثابتة الهوية عمدًا: تغيير التبويب أو فلاتر المراقبة ما يعيدش تحميل المحادثة المفتوحة
  const listTimer = useRef(null)
  const latest = useRef({})
  latest.current = { loadInbox, loadMonitor, tab }
  const refreshLists = useCallback(() => {
    clearTimeout(listTimer.current)
    listTimer.current = setTimeout(() => {
      const { loadInbox, loadMonitor, tab } = latest.current
      loadInbox(); if (tab === 'monitor') loadMonitor()
    }, 500)
  }, [])

  // تحديث القائمة محليًا من القناة اللحظية — من غير طلب للسيرفر مع كل رسالة
  useEffect(() => onChat((event, p) => {
    if (event === 'msg_new') {
      setInbox(list => {
        const i = list.findIndex(c => c.conversation_id === p.conversation_id)
        if (i < 0) { refreshLists(); return list }   // محادثة جديدة لسه مش في القائمة
        const c = list[i]
        const counts = p.sender_id !== meId && !watchingConv(p.conversation_id)
        const upd = {
          ...c,
          last_message_at: p.created_at,
          last_message_preview: p.body ? p.body.slice(0, 140) : '📎 ليد: ' + (p.lead_label ?? ''),
          last_sender_id: p.sender_id,
          unread: counts ? (c.unread ?? 0) + 1 : c.unread,
        }
        return [upd, ...list.slice(0, i), ...list.slice(i + 1)]
      })
    } else if (event === 'read' && p.user_id === meId) {
      setInbox(list => list.map(c => c.conversation_id === p.conversation_id ? { ...c, unread: 0 } : c))
    } else if (event === 'msg_update' || event === 'members' || event === 'resync') {
      refreshLists()
    } else if (event === 'activity' && latest.current.tab === 'monitor') {
      refreshLists()
    }
  }), [meId, refreshLists])

  const shownInbox = useMemo(() => {
    const s = filter.trim()
    if (!s) return inbox
    return inbox.filter(c => convName(c, meId).includes(s) || (c.last_message_preview ?? '').includes(s))
  }, [inbox, filter, meId])

  const list = tab === 'monitor' ? monitor : shownInbox

  return (
    <div className={'chat-page' + (activeId ? ' has-active' : '')}>
      {/* ---------- القائمة ---------- */}
      <aside className="chat-list">
        <div className="chat-list-head">
          <div className="chat-list-title">
            <h1>الشات</h1>
            <button className="btn btn-primary chat-new-btn" onClick={() => setShowNew(true)}>+ محادثة</button>
          </div>
          <PushToggle />
          {canMonitor && (
            <div className="tabs chat-tabs">
              <button className={'tab' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>محادثاتي</button>
              <button className={'tab' + (tab === 'monitor' ? ' on' : '')} onClick={() => setTab('monitor')}>👁 المراقبة</button>
            </div>
          )}
          {tab === 'mine' ? (
            <input className="chat-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="بحث في محادثاتي" />
          ) : (
            <div className="chat-mon-filters">
              <select value={monUser} onChange={e => setMonUser(e.target.value)}>
                <option value="">كل الموظفين</option>
                {employees.filter(e => e.id !== meId).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
              <input className="chat-search" value={monSearch} onChange={e => setMonSearch(e.target.value)}
                placeholder="كلمة في الرسائل (حتى المحذوفة) أو اسم" />
            </div>
          )}
        </div>

        <div className="chat-list-body">
          {listLoading && <div className="chat-muted">جارٍ التحميل…</div>}
          {!listLoading && !list.length && (
            <div className="empty">
              <strong>{tab === 'monitor' ? 'لا توجد محادثات' : 'لا توجد محادثات بعد'}</strong>
              {tab === 'mine' && 'ابدأ محادثة مع زميل من زر «+ محادثة»'}
            </div>
          )}
          {list.map(c => (
            <button key={c.conversation_id}
              className={'chat-item' + (c.conversation_id === activeId ? ' active' : '') + (c.unread ? ' unread' : '')}
              onClick={() => openConv(c.conversation_id)}>
              <span className={'chat-avatar' + (c.kind === 'group' ? ' group' : '')}>
                {c.kind === 'group' ? '👥' : convName(c, meId).trim()[0]}
              </span>
              <span className="chat-item-main">
                <span className="chat-item-top">
                  <strong>{convName(c, meId)}</strong>
                  <time>{listTime(c.last_message_at)}</time>
                </span>
                <span className="chat-item-bottom">
                  <span className="chat-preview">
                    {c.last_sender_id === meId && 'أنت: '}{c.last_message_preview || 'لا رسائل بعد'}
                  </span>
                  {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
                  {tab === 'monitor' && c.edited_or_deleted > 0 && (
                    <span className="chat-flag" title="رسائل معدّلة أو محذوفة">✎ {c.edited_or_deleted}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="chat-notice">🔒 المحادثات الداخلية خاضعة لمراجعة الإدارة</div>
      </aside>

      {/* ---------- المحادثة ---------- */}
      <section className="chat-thread-wrap">
        {activeId ? (
          <Thread key={activeId} convId={activeId} meId={meId} canMonitor={canMonitor}
            onBack={() => openConv(null)} onListChanged={refreshLists}
            onOpenLead={setLeadOpen} onLeft={() => { openConv(null); loadInbox() }} />
        ) : (
          <div className="chat-placeholder">
            <div>💬</div>
            <strong>اختار محادثة من القائمة</strong>
            <span>أو ابدأ محادثة جديدة مع زميل</span>
          </div>
        )}
      </section>

      {showNew && (
        <NewChatModal meId={meId} canGroup={canGroup} onClose={() => setShowNew(false)}
          onOpened={(id) => { setShowNew(false); setTab('mine'); loadInbox(); openConv(id) }} />
      )}

      {leadOpen && (
        <LeadDrawer leadId={leadOpen} refs={refs} onClose={() => setLeadOpen(null)} onChanged={() => {}} />
      )}
    </div>
  )
}

// =====================================================================
function Thread({ convId, meId, canMonitor, onBack, onListChanged, onOpenLead, onLeft }) {
  const [conv, setConv] = useState(null)
  const [parts, setParts] = useState([])
  const [msgs, setMsgs] = useState([])
  const [history, setHistory] = useState({})     // message_id → [{action, old_body, at}]
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [text, setText] = useState('')
  const [reply, setReply] = useState(null)
  const [editing, setEditing] = useState(null)
  const [lead, setLead] = useState(null)
  const [pickLead, setPickLead] = useState(false)
  const [menuFor, setMenuFor] = useState(null)
  const [openHist, setOpenHist] = useState(null)
  const [showInfo, setShowInfo] = useState(false)

  const scroller = useRef(null)
  const stickBottom = useRef(true)
  const inputRef = useRef(null)

  const me = parts.find(p => p.user_id === meId && !p.left_at)
  const isMember = !!me
  const readOnly = !isMember
  const activeParts = parts.filter(p => !p.left_at)
  const others = activeParts.filter(p => p.user_id !== meId)
  const nameOf = useCallback((id) => parts.find(p => p.user_id === id)?.profiles?.full_name ?? 'موظف', [parts])

  const title = conv?.kind === 'group'
    ? conv.title
    : readOnly ? activeParts.map(p => p.profiles?.full_name).join(' ↔ ') : others[0]?.profiles?.full_name

  // ---------- التحميل ----------
  const loadHistoryFor = useCallback(async (list) => {
    if (!canMonitor) return
    const ids = list.filter(m => m.edited_at || m.deleted_at).map(m => m.id)
    if (!ids.length) return
    const rows = await fetchHistory(ids)
    setHistory(h => {
      const next = { ...h }
      ids.forEach(id => { next[id] = rows.filter(r => r.message_id === id) })
      return next
    })
  }, [canMonitor])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const [c, p, m] = await Promise.all([fetchConversation(convId), fetchParticipants(convId), fetchMessages(convId)])
        if (dead) return
        setConv(c); setParts(p); setMsgs(m); setHasMore(m.length === PAGE)
        setLoading(false)
        loadHistoryFor(m)
        // في الخلفية — الشاشة ما تستناش
        const member = p.some(x => x.user_id === meId && !x.left_at)
        if (member) markRead(convId).then(() => window.dispatchEvent(new Event('chat:read')))
        else logMonitorView(convId)
      } catch (e) { if (!dead) setErr(errText(e)) }
      if (!dead) setLoading(false)
    })()
    return () => { dead = true }
  }, [convId, meId, loadHistoryFor])

  const loadOlder = async () => {
    if (!msgs.length) return
    const el = scroller.current
    const prevH = el?.scrollHeight ?? 0
    const older = await fetchMessages(convId, msgs[0].created_at)
    setHasMore(older.length === PAGE)
    stickBottom.current = false
    setMsgs(m => [...older, ...m])
    loadHistoryFor(older)
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH })
  }

  // ---------- لحظي ----------
  const readTimer = useRef(null)
  const markReadSoon = useCallback(() => {
    clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => {
      markRead(convId).then(() => window.dispatchEvent(new Event('chat:read')))
    }, 400)
  }, [convId])

  const upsert = (m) => setMsgs(list =>
    list.some(x => x.id === m.id) ? list.map(x => x.id === m.id ? m : x) : [...list, m])

  useEffect(() => {
    const off = onChat(async (event, p) => {
      if (event !== 'resync' && p.conversation_id !== convId) return
      if (event === 'msg_new') {
        upsert(p)   // لو هي رسالتي اللي لسه «بتتبعت» بتتأكد هنا
        if (p.sender_id !== meId && isMember && document.visibilityState === 'visible') markReadSoon()
      } else if (event === 'msg_update') {
        upsert(p); loadHistoryFor([p])
      } else if (event === 'read') {
        setParts(list => list.map(x => x.user_id === p.user_id ? { ...x, last_read_at: p.last_read_at } : x))
      } else if (event === 'members') {
        const [c, pp] = await Promise.all([fetchConversation(convId), fetchParticipants(convId)])
        setConv(c); setParts(pp)
      } else if (event === 'activity' && !isMember) {
        // المراقبة: الحدث فيه المعرّف بس، والرسالة نفسها بتتجاب حسب الصلاحية
        try { const m = await fetchMessage(p.message_id); upsert(m); if (p.op === 'update') loadHistoryFor([m]) } catch {}
      } else if (event === 'resync') {
        // رجع الاتصال بعد انقطاع — نجيب اللي فاتنا
        const [fresh, pp] = await Promise.all([fetchMessages(convId), fetchParticipants(convId)])
        setParts(pp)
        setMsgs(list => {
          const byId = new Map(list.map(x => [x.id, x]))
          fresh.forEach(m => byId.set(m.id, m))
          return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        })
        if (isMember && document.visibilityState === 'visible') markReadSoon()
      }
    })
    return () => { off(); clearTimeout(readTimer.current) }
  }, [convId, meId, isMember, loadHistoryFor, markReadSoon])

  // لما الموظف يرجع للتبويب نعلّم المحادثة كمقروءة
  useEffect(() => {
    if (!isMember) return
    const onVis = () => { if (document.visibilityState === 'visible') markReadSoon() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [isMember, markReadSoon])

  // ---------- التمرير ----------
  const onScroll = () => {
    const el = scroller.current
    if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = scroller.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [msgs, loading])

  // ---------- الإرسال ----------
  // الرسالة بتظهر فورًا بعلامة 🕓، وبتتأكد لما السيرفر يرد أو يوصل الحدث اللحظي
  const deliver = async (m) => {
    setMsgs(list => list.map(x => x.id === m.id ? { ...x, _status: 'sending' } : x))
    try {
      const saved = await sendMessage({ id: m.id, convId, senderId: meId, body: m.body, leadId: m.lead_id, replyTo: m.reply_to })
      setMsgs(list => list.map(x => x.id === m.id ? saved : x))
    } catch (e) {
      setMsgs(list => list.map(x => x.id === m.id ? { ...x, _status: 'failed', _err: errText(e) } : x))
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body && !lead) return
    setErr('')

    if (editing) {
      const before = editing
      setEditing(null); setText('')
      setMsgs(list => list.map(x => x.id === before.id ? { ...x, body, edited_at: new Date().toISOString() } : x))
      try { await editMessage(before.id, body) }
      catch (e) { setErr(errText(e)); setMsgs(list => list.map(x => x.id === before.id ? before : x)) }
      return
    }

    const temp = {
      id: newMsgId(), conversation_id: convId, sender_id: meId, body: body || null,
      lead_id: lead?.id ?? null,
      lead_label: lead ? [lead.file_no, lead.full_name].filter(Boolean).join(' · ') : null,
      reply_to: reply?.id ?? null, created_at: new Date().toISOString(),
      edited_at: null, deleted_at: null, _status: 'sending',
    }
    stickBottom.current = true
    setMsgs(list => [...list, temp])
    setText(''); setReply(null); setLead(null)
    inputRef.current?.focus()
    deliver(temp)
  }

  const discard = (m) => setMsgs(list => list.filter(x => x.id !== m.id))

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); send() }
    if (e.key === 'Escape') { setEditing(null); setReply(null); setText(editing ? '' : text) }
  }

  const startEdit = (m) => { setMenuFor(null); setReply(null); setEditing(m); setText(m.body ?? ''); inputRef.current?.focus() }
  const doDelete = async (m) => {
    setMenuFor(null)
    if (!confirm('حذف الرسالة؟')) return
    try {
      setMsgs(list => list.map(x => x.id === m.id ? { ...x, body: null, lead_id: null, lead_label: null, deleted_at: new Date().toISOString() } : x))
      await deleteMessage(m.id)
    } catch (e) { setErr(errText(e)) }
  }

  // علامة القراءة لرسائلي
  const readState = (m) => {
    if (!others.length) return ''
    const readers = others.filter(p => new Date(p.last_read_at) >= new Date(m.created_at))
    if (readers.length === others.length) return 'read'
    return readers.length ? 'partial' : 'sent'
  }

  const byId = useMemo(() => Object.fromEntries(msgs.map(m => [m.id, m])), [msgs])

  if (loading) return <div className="chat-placeholder"><span>جارٍ التحميل…</span></div>
  if (!conv) return (
    <div className="chat-placeholder">
      <strong>تعذّر فتح المحادثة</strong><span>{err}</span>
      <button className="btn btn-ghost" onClick={onBack}>رجوع</button>
    </div>
  )

  return (
    <div className="chat-thread" onClick={() => menuFor && setMenuFor(null)}>
      <header className="chat-thread-head">
        <button className="chat-icon-btn chat-back" onClick={onBack} aria-label="رجوع">→</button>
        <span className={'chat-avatar' + (conv.kind === 'group' ? ' group' : '')}>
          {conv.kind === 'group' ? '👥' : (title ?? '').trim()[0]}
        </span>
        <div className="chat-thread-title">
          <strong>{title}</strong>
          <small>
            {conv.kind === 'group'
              ? `${activeParts.length} عضو`
              : readOnly ? 'محادثة فردية' : others[0]?.profiles?.roles?.name_ar}
          </small>
        </div>
        {conv.lead_id && (
          <button className="chat-lead-chip" onClick={() => onOpenLead(conv.lead_id)}>📎 ليد الجروب</button>
        )}
        {conv.kind === 'group' && (
          <button className="chat-icon-btn" onClick={() => setShowInfo(true)} title="تفاصيل الجروب">ⓘ</button>
        )}
      </header>

      {readOnly && (
        <div className="chat-monitor-bar">👁 وضع المراقبة — قراءة فقط. فتحك للمحادثة بيتسجل.</div>
      )}

      <div className="chat-messages" ref={scroller} onScroll={onScroll}>
        {hasMore && <button className="chat-older" onClick={loadOlder}>تحميل رسائل أقدم</button>}
        {!msgs.length && <div className="chat-muted center">لا رسائل بعد — ابدأ الكلام 👋</div>}

        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
          const mine = m.sender_id === meId
          const showName = !mine && (conv.kind === 'group' || readOnly) && (newDay || prev?.sender_id !== m.sender_id)
          const hist = history[m.id]
          const replied = m.reply_to ? byId[m.reply_to] : null
          const rs = mine && !m._status ? readState(m) : ''
          return (
            <div key={m.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={'chat-row' + (mine ? ' mine' : '')}>
                <div className={'chat-bubble' + (m.deleted_at ? ' deleted' : '')}>
                  {showName && <div className="chat-sender">{nameOf(m.sender_id)}</div>}

                  {replied && (
                    <div className="chat-reply-ref">
                      <b>{nameOf(replied.sender_id)}</b>
                      <span>{replied.deleted_at ? '🚫 رسالة محذوفة' : (replied.body || '📎 ' + (replied.lead_label ?? 'ليد'))}</span>
                    </div>
                  )}

                  {m.deleted_at ? (
                    <div className="chat-body muted">🚫 تم حذف هذه الرسالة</div>
                  ) : (
                    <>
                      {m.body && <div className="chat-body">{m.body}</div>}
                      {m.lead_id && (
                        <button className="chat-lead-chip" onClick={() => onOpenLead(m.lead_id)}>📎 {m.lead_label}</button>
                      )}
                    </>
                  )}

                  {/* للمديرين: النص الأصلي قبل الحذف/التعديل */}
                  {canMonitor && hist?.length > 0 && (
                    <div className="chat-hist">
                      <button onClick={() => setOpenHist(openHist === m.id ? null : m.id)}>
                        {m.deleted_at ? '👁 النص المحذوف' : `👁 النسخ السابقة (${hist.length})`}
                      </button>
                      {(openHist === m.id || m.deleted_at) && hist.map((h, k) => (
                        <div key={k} className="chat-hist-row">
                          <small>{h.action === 'delete' ? 'قبل الحذف' : 'قبل التعديل'} · {fmtTime(h.at)} {dayLabel(h.at)}</small>
                          <div>{h.old_body}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="chat-meta">
                    {m.edited_at && !m.deleted_at && <span>معدّلة</span>}
                    <time>{fmtTime(m.created_at)}</time>
                    {m._status === 'sending' && <span className="chat-tick" title="بتتبعت">🕓</span>}
                    {rs && <span className={'chat-tick ' + rs}
                      title={rs === 'read' ? 'اتقرت' : rs === 'partial' ? 'اتقرت من بعض الأعضاء' : 'اتبعتت'}>
                      {rs === 'sent' ? '✓' : '✓✓'}</span>}
                  </div>

                  {m._status === 'failed' && (
                    <div className="chat-failed" title={m._err}>
                      ⚠ لم تُرسل
                      <button onClick={() => deliver(m)}>إعادة</button>
                      <button onClick={() => discard(m)}>إلغاء</button>
                    </div>
                  )}

                  {!readOnly && !m.deleted_at && !m._status && (
                    <button className="chat-msg-menu-btn" aria-label="خيارات"
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id) }}>⋯</button>
                  )}
                  {menuFor === m.id && (
                    <div className="chat-msg-menu" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setMenuFor(null); setEditing(null); setReply(m); inputRef.current?.focus() }}>↩ رد</button>
                      {mine && m.body && canEditMsg(m) && <button onClick={() => startEdit(m)}>✎ تعديل</button>}
                      {mine && <button className="danger" onClick={() => doDelete(m)}>🗑 حذف</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {!readOnly && (
        <footer className="chat-composer">
          {(reply || editing) && (
            <div className="chat-compose-ctx">
              <span>{editing ? '✎ تعديل الرسالة' : `↩ رد على ${nameOf(reply.sender_id)}: ${reply.body ?? reply.lead_label ?? ''}`}</span>
              <button className="chat-icon-btn" onClick={() => { setReply(null); if (editing) { setEditing(null); setText('') } }}>✕</button>
            </div>
          )}
          {lead && (
            <div className="chat-compose-ctx">
              <span>📎 {lead.full_name}{lead.file_no ? ` · ${lead.file_no}` : ''}</span>
              <button className="chat-icon-btn" onClick={() => setLead(null)}>✕</button>
            </div>
          )}
          {pickLead && (
            <LeadPicker onPick={(l) => { setLead(l); setPickLead(false); inputRef.current?.focus() }}
              onClose={() => setPickLead(false)} />
          )}
          {err && <div className="chat-err">{err}</div>}
          <div className="chat-compose-row">
            {!editing && (
              <button className="chat-icon-btn" title="إرفاق ليد" onClick={() => setPickLead(v => !v)}>📎</button>
            )}
            <textarea ref={inputRef} rows={1} value={text} maxLength={4000}
              onChange={e => setText(e.target.value)} onKeyDown={onKey}
              placeholder="اكتب رسالة…" />
            <button className="btn btn-primary chat-send" disabled={!text.trim() && !lead} onClick={send}>
              {editing ? 'حفظ' : 'إرسال'}
            </button>
          </div>
        </footer>
      )}

      {showInfo && conv.kind === 'group' && (
        <GroupInfoModal conv={conv} participants={parts} meId={meId}
          canAdmin={canMonitor || !!me?.is_admin} readOnly={readOnly}
          onClose={() => setShowInfo(false)}
          onChanged={async () => {
            const [c, p] = await Promise.all([fetchConversation(convId), fetchParticipants(convId)])
            setConv(c); setParts(p); onListChanged()
          }}
          onLeft={() => { setShowInfo(false); onLeft() }} />
      )}
    </div>
  )
}
