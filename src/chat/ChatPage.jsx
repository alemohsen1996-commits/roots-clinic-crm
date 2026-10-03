// الشات الداخلي بين الموظفين
// • «محادثاتي»: محادثات الموظف الفردية والجروبات
// • «المراقبة» (المدير العام + مدير المبيعات): كل محادثات الموظفين قراءة فقط،
//   مع النص الأصلي لأي رسالة اتعدلت أو اتمسحت — وفتح المحادثة بيتسجل
import i18n from '../i18n'
import useT from '../i18n/useT'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fmtDate } from '../lib/format'
import LeadDrawer from '../leads/LeadDrawer'
import { useLeadRefs } from '../leads/useLeadRefs'
import {
  PAGE, convName, deleteMessage, editMessage, errText, fetchConversation, fetchEmployees,
  fetchHistory, fetchInbox, fetchMessage, fetchMessages, fetchMonitorList, fetchParticipants,
  logMonitorView, markRead, newMsgId, sendMessage, uploadAttachment, discardAttachment,
  extractMentions, pinMessage,
} from './chatApi'
import Attachment from './Attachment'
import { supabase } from '../lib/supabase'
import { onChat, watchingConv } from './chatRealtime'
import NewChatModal from './NewChatModal'
import GroupInfoModal from './GroupInfoModal'
import LeadPicker from './LeadPicker'
import PushToggle from './PushToggle'
import './chat.css'

const LOC = () => (i18n.language === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn')
const fmtTime = (d) => new Date(d).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })
const dayKey = (d) => new Date(d).toDateString()
function dayLabel(d) {
  const x = new Date(d), today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (x.toDateString() === today.toDateString()) return i18n.t('task.quick.today')
  if (x.toDateString() === y.toDateString()) return i18n.t('chat.yesterday')
  return fmtDate(d)
}
function listTime(d) {
  if (!d) return ''
  return new Date(d).toDateString() === new Date().toDateString() ? fmtTime(d)
    : new Date(d).toLocaleDateString(LOC(), { day: 'numeric', month: 'short' })
}
const canEditMsg = (m) => Date.now() - new Date(m.created_at).getTime() < 24 * 3600 * 1000
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches

export default function ChatPage() {
  const { profile, roleCode } = useAuth()
  const { t } = useT()
  const meId = profile.id
  const canMonitor = roleCode === 'super_admin' || roleCode === 'sales_manager'
  const canGroup = canMonitor
  const refs = useLeadRefs()

  const [params, setParams] = useSearchParams()
  const activeId = params.get('c')
  const leadParam = params.get('lead')   // جاي من ملف الليد: «ناقش مع المنسقة» — الليد بيتربط تلقائيًا
  const openConv = (id) => setParams(id ? { c: id } : {})
  const [mentionsOnly, setMentionsOnly] = useState(false)

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
          last_message_preview: p.body ? p.body.slice(0, 140)
            : p.attachment_type === 'image' ? `📷 ${t('chat.att.image')}`
            : p.attachment_type === 'file' ? `📄 ${p.attachment_name ?? t('chat.att.file')}`
            : `📎 ${t('chat.leadLabel')}: ` + (p.lead_label ?? ''),
          last_sender_id: p.sender_id,
          unread: counts ? (c.unread ?? 0) + 1 : c.unread,
        }
        return [upd, ...list.slice(0, i), ...list.slice(i + 1)]
      })
    } else if (event === 'read' && p.user_id === meId) {
      setInbox(list => list.map(c => c.conversation_id === p.conversation_id ? { ...c, unread: 0, mentions_unread: 0 } : c))
    } else if (event === 'mention') {
      setInbox(list => list.map(c => c.conversation_id === p.conversation_id && !watchingConv(p.conversation_id)
        ? { ...c, mentions_unread: (c.mentions_unread ?? 0) + 1 } : c))
    } else if (event === 'msg_update' || event === 'members' || event === 'resync') {
      refreshLists()
    } else if (event === 'activity' && latest.current.tab === 'monitor') {
      refreshLists()
    }
  }), [meId, refreshLists])

  const shownInbox = useMemo(() => {
    const s = filter.trim()
    let out = inbox
    if (mentionsOnly) out = out.filter(c => (c.mentions_unread ?? 0) > 0)
    if (!s) return out
    return out.filter(c => convName(c, meId).includes(s) || (c.last_message_preview ?? '').includes(s))
  }, [inbox, filter, meId, mentionsOnly])
  const mentionTotal = useMemo(() => inbox.reduce((a, c) => a + (c.mentions_unread ?? 0), 0), [inbox])

  const list = tab === 'monitor' ? monitor : shownInbox

  return (
    <div className={'chat-page' + (activeId ? ' has-active' : '')}>
      {/* ---------- القائمة ---------- */}
      <aside className="chat-list">
        <div className="chat-list-head">
          <div className="chat-list-title">
            <h1>{t('nav.chat')}</h1>
            <button className="btn btn-primary chat-new-btn" onClick={() => setShowNew(true)}>+ {t('chat.conversation')}</button>
          </div>
          <PushToggle />
          {canMonitor && (
            <div className="tabs chat-tabs">
              <button className={'tab' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>{t('chat.myChats')}</button>
              <button className={'tab' + (tab === 'monitor' ? ' on' : '')} onClick={() => setTab('monitor')}>👁 {t('chat.monitor')}</button>
            </div>
          )}
          {tab === 'mine' ? (
            <div className="chat-mine-filters">
              <input className="chat-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('chat.searchMine')} />
              {(mentionTotal > 0 || mentionsOnly) && (
                <button type="button" className={'chip' + (mentionsOnly ? ' on' : '')} onClick={() => setMentionsOnly(v => !v)}>
                  @ {t('chat.mentionsFilter')}{mentionTotal > 0 ? ` (${mentionTotal})` : ''}
                </button>
              )}
            </div>
          ) : (
            <div className="chat-mon-filters">
              <select value={monUser} onChange={e => setMonUser(e.target.value)}>
                <option value="">{t('chat.allEmployees')}</option>
                {employees.filter(e => e.id !== meId).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
              <input className="chat-search" value={monSearch} onChange={e => setMonSearch(e.target.value)}
                placeholder={t('chat.monitorSearchPh')} />
            </div>
          )}
        </div>

        <div className="chat-list-body">
          {listLoading && <div className="chat-muted">{t('common.loading')}</div>}
          {!listLoading && !list.length && (
            <div className="empty">
              <strong>{tab === 'monitor' ? t('chat.noChats') : t('chat.noChatsYet')}</strong>
              {tab === 'mine' && t('chat.startHint')}
            </div>
          )}
          {list.map(c => (
            <button key={c.conversation_id}
              className={'chat-item' + (c.conversation_id === activeId ? ' active' : '') + (c.unread ? ' unread' : '')}
              onClick={() => openConv(c.conversation_id)}>
              <span className={'chat-avatar' + (c.kind === 'group' ? ' group' : '')}>
                {c.announce ? '📣' : c.kind === 'group' ? '👥' : convName(c, meId).trim()[0]}
              </span>
              <span className="chat-item-main">
                <span className="chat-item-top">
                  <strong>{convName(c, meId)}</strong>
                  <time>{listTime(c.last_message_at)}</time>
                </span>
                <span className="chat-item-bottom">
                  <span className="chat-preview">
                    {c.last_sender_id === meId && `${t('chat.you')}: `}{c.last_message_preview || t('chat.noMessagesYet')}
                  </span>
                  {c.mentions_unread > 0 && <span className="nav-badge chat-mention-badge">@</span>}
                  {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
                  {tab === 'monitor' && c.edited_or_deleted > 0 && (
                    <span className="chat-flag" title={t('chat.editedOrDeleted')}>✎ {c.edited_or_deleted}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="chat-notice">🔒 {t('chat.notice')}</div>
      </aside>

      {/* ---------- المحادثة ---------- */}
      <section className="chat-thread-wrap">
        {activeId ? (
          <Thread key={activeId} convId={activeId} meId={meId} canMonitor={canMonitor} leadParam={leadParam}
            onBack={() => openConv(null)} onListChanged={refreshLists}
            onOpenLead={setLeadOpen} onLeft={() => { openConv(null); loadInbox() }} />
        ) : (
          <div className="chat-placeholder">
            <div>💬</div>
            <strong>{t('chat.pickFromList')}</strong>
            <span>{t('chat.orStartNew')}</span>
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
function Thread({ convId, meId, canMonitor, leadParam, onBack, onListChanged, onOpenLead, onLeft }) {
  const { t, dn, isRtl } = useT()
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
  const [att, setAtt] = useState(null)             // { file, preview } مرفق مستني الإرسال
  const [mention, setMention] = useState(null)     // { q, start } القائمة مفتوحة بعد @
  const [pinnedMsg, setPinnedMsg] = useState(null)
  const fileRef = useRef(null)

  const scroller = useRef(null)
  const stickBottom = useRef(true)
  const inputRef = useRef(null)

  const me = parts.find(p => p.user_id === meId && !p.left_at)
  const isMember = !!me
  const readOnly = !isMember
  // قناة الإعلانات: الأدمن بس اللي يكتب
  const canWrite = isMember && (!conv?.announce || me?.is_admin)
  const canPin = isMember && (me?.is_admin || canMonitor)
  const activeParts = parts.filter(p => !p.left_at)
  const others = activeParts.filter(p => p.user_id !== meId)
  const nameOf = useCallback((id) => parts.find(p => p.user_id === id)?.profiles?.full_name ?? t('chat.employee'), [parts, t])

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
        if (leadParam) {
          const { data: l } = await supabase.from('leads').select('id, file_no, full_name').eq('id', Number(leadParam)).maybeSingle()
          if (l && !dead) { setLead(l); setTimeout(() => inputRef.current?.focus(), 50) }
        }
        // في الخلفية — الشاشة ما تستناش
        const member = p.some(x => x.user_id === meId && !x.left_at)
        if (member) markRead(convId).then(() => window.dispatchEvent(new Event('chat:read')))
        else logMonitorView(convId)
      } catch (e) { if (!dead) setErr(errText(e)) }
      if (!dead) setLoading(false)
    })()
    return () => { dead = true }
  }, [convId, meId, loadHistoryFor, leadParam])

  // الرسالة المثبّتة
  useEffect(() => {
    const id = conv?.pinned_message_id
    if (!id) { setPinnedMsg(null); return }
    const local = msgs.find(m => m.id === id)
    if (local) { setPinnedMsg(local); return }
    fetchMessage(id).then(setPinnedMsg).catch(() => setPinnedMsg(null))
  }, [conv?.pinned_message_id, msgs])

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
      let attachment = m._attachment ?? null
      if (m._file) {
        setMsgs(list => list.map(x => x.id === m.id ? { ...x, _status: 'uploading' } : x))
        attachment = await uploadAttachment(m._file, meId)
        setMsgs(list => list.map(x => x.id === m.id ? { ...x, _attachment: attachment, _file: null, _status: 'sending' } : x))
      }
      const saved = await sendMessage({ id: m.id, convId, senderId: meId, body: m.body, leadId: m.lead_id, replyTo: m.reply_to,
        attachment, mentions: m.mentions ?? [] })
      setMsgs(list => list.map(x => x.id === m.id ? saved : x))
    } catch (e) {
      setMsgs(list => list.map(x => x.id === m.id ? { ...x, _status: 'failed', _err: errText(e) } : x))
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body && !lead && !att) return
    setErr('')

    if (editing) {
      const before = editing
      setEditing(null); setText('')
      setMsgs(list => list.map(x => x.id === before.id ? { ...x, body, edited_at: new Date().toISOString() } : x))
      try { await editMessage(before.id, body) }
      catch (e) { setErr(errText(e)); setMsgs(list => list.map(x => x.id === before.id ? before : x)) }
      return
    }

    const people = activeParts.map(p => ({ id: p.user_id, full_name: p.profiles?.full_name }))
    const temp = {
      id: newMsgId(), conversation_id: convId, sender_id: meId, body: body || null,
      lead_id: lead?.id ?? null,
      lead_label: lead ? [lead.file_no, lead.full_name].filter(Boolean).join(' · ') : null,
      reply_to: reply?.id ?? null, created_at: new Date().toISOString(),
      edited_at: null, deleted_at: null, _status: 'sending',
      mentions: body ? extractMentions(body, people) : [],
      attachment_type: att ? (att.file.type.startsWith('image/') ? 'image' : 'file') : null,
      attachment_name: att?.file.name ?? null,
      _file: att?.file ?? null, _preview: att?.preview ?? null,
    }
    stickBottom.current = true
    setMsgs(list => [...list, temp])
    setText(''); setReply(null); setLead(null); setAtt(null); setMention(null)
    inputRef.current?.focus()
    deliver(temp)
  }

  const discard = (m) => { if (m._attachment?.path) discardAttachment(m._attachment.path); setMsgs(list => list.filter(x => x.id !== m.id)) }

  // ---------- المرفق ----------
  const pickFile = (f) => {
    if (!f) return
    const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
    setAtt({ file: f, preview })
    inputRef.current?.focus()
  }
  const onPaste = (e) => {
    const f = [...(e.clipboardData?.files ?? [])][0]
    if (f) { e.preventDefault(); pickFile(f) }
  }

  // ---------- المنشن: @ + اسم ----------
  const onTextChange = (e) => {
    const v = e.target.value
    setText(v)
    const caret = e.target.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const m = /(?:^|\s)@([^@\n]{0,30})$/.exec(before)
    setMention(m && conv?.kind === 'group' ? { q: m[1], start: caret - m[1].length - 1 } : null)
  }
  const mentionList = useMemo(() => {
    if (!mention) return []
    const q = mention.q.trim()
    return others.filter(p => !q || (p.profiles?.full_name ?? '').includes(q)).slice(0, 6)
  }, [mention, others])
  const applyMention = (p) => {
    const name = p.profiles?.full_name ?? ''
    const caret = inputRef.current?.selectionStart ?? text.length
    const next = text.slice(0, mention.start) + '@' + name + ' ' + text.slice(caret)
    setText(next); setMention(null)
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); const pos = mention.start + name.length + 2; el.setSelectionRange(pos, pos) } })
  }

  // ---------- التثبيت ----------
  const togglePin = async (m) => {
    setMenuFor(null)
    try { await pinMessage(convId, conv?.pinned_message_id === m.id ? null : m.id) }
    catch (e) { setErr(errText(e)) }
  }

  // نص الرسالة مع تلوين المنشن
  const memberNames = useMemo(() => activeParts.map(p => p.profiles?.full_name).filter(Boolean).sort((a, b) => b.length - a.length), [activeParts])
  const renderBody = (body) => {
    if (!body || !memberNames.length) return body
    const re = new RegExp('@(' + memberNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g')
    const out = []; let last = 0; let m
    while ((m = re.exec(body))) {
      if (m.index > last) out.push(body.slice(last, m.index))
      out.push(<b key={m.index} className="chat-mention">@{m[1]}</b>)
      last = m.index + m[0].length
    }
    if (last < body.length) out.push(body.slice(last))
    return out
  }

  const onKey = (e) => {
    if (mention && mentionList.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); applyMention(mentionList[0]); return }
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); send() }
    if (e.key === 'Escape') { setMention(null); setEditing(null); setReply(null); setText(editing ? '' : text) }
  }

  const startEdit = (m) => { setMenuFor(null); setReply(null); setEditing(m); setText(m.body ?? ''); inputRef.current?.focus() }
  const doDelete = async (m) => {
    setMenuFor(null)
    if (!confirm(t('chat.deleteQ'))) return
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

  if (loading) return <div className="chat-placeholder"><span>{t('common.loading')}</span></div>
  if (!conv) return (
    <div className="chat-placeholder">
      <strong>{t('chat.openFailed')}</strong><span>{err}</span>
      <button className="btn btn-ghost" onClick={onBack}>{t('common.back')}</button>
    </div>
  )

  return (
    <div className="chat-thread" onClick={() => menuFor && setMenuFor(null)}>
      <header className="chat-thread-head">
        <button className="chat-icon-btn chat-back" onClick={onBack} aria-label={t('common.back')}>{isRtl ? '→' : '←'}</button>
        <span className={'chat-avatar' + (conv.kind === 'group' ? ' group' : '')}>
          {conv.kind === 'group' ? '👥' : (title ?? '').trim()[0]}
        </span>
        <div className="chat-thread-title">
          <strong>{title}</strong>
          <small>
            {conv.kind === 'group'
              ? t('chat.nMembers', { n: activeParts.length })
              : readOnly ? t('chat.directChat') : dn(others[0]?.profiles?.roles)}
            {conv.announce && <> · 📣 {t('chat.announce')}</>}
          </small>
        </div>
        {conv.lead_id && (
          <button className="chat-lead-chip" onClick={() => onOpenLead(conv.lead_id)}>📎 {t('chat.groupLead')}</button>
        )}
        {conv.kind === 'group' && (
          <button className="chat-icon-btn" onClick={() => setShowInfo(true)} title={t('chat.groupInfo')}>ⓘ</button>
        )}
      </header>

      {readOnly && (
        <div className="chat-monitor-bar">👁 {t('chat.monitorBar')}</div>
      )}
      {!readOnly && !canWrite && (
        <div className="chat-monitor-bar announce">📣 {t('chat.announceReadOnly')}</div>
      )}
      {pinnedMsg && !pinnedMsg.deleted_at && (
        <button type="button" className="chat-pinned" onClick={() => {
          const el = document.getElementById('msg-' + pinnedMsg.id)
          if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500) }
        }}>
          <span className="chat-pinned-tag">📌 {t('chat.pinned')}</span>
          <span className="chat-pinned-body">{pinnedMsg.body || pinnedMsg.attachment_name || pinnedMsg.lead_label}</span>
          <small>{nameOf(pinnedMsg.sender_id)}</small>
        </button>
      )}

      <div className="chat-messages" ref={scroller} onScroll={onScroll}>
        {hasMore && <button className="chat-older" onClick={loadOlder}>{t('chat.loadOlder')}</button>}
        {!msgs.length && <div className="chat-muted center">{t('chat.noMessagesStart')} 👋</div>}

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
              <div className={'chat-row' + (mine ? ' mine' : '')} id={'msg-' + m.id}>
                <div className={'chat-bubble' + (m.deleted_at ? ' deleted' : '') + ((m.mentions ?? []).includes(meId) ? ' mentions-me' : '') + (conv.pinned_message_id === m.id ? ' pinned' : '')}>
                  {showName && <div className="chat-sender">{nameOf(m.sender_id)}</div>}

                  {replied && (
                    <div className="chat-reply-ref">
                      <b>{nameOf(replied.sender_id)}</b>
                      <span>{replied.deleted_at ? `🚫 ${t('chat.deletedMessage')}` : (replied.body || '📎 ' + (replied.lead_label ?? t('chat.leadLabel')))}</span>
                    </div>
                  )}

                  {m.deleted_at ? (
                    <div className="chat-body muted">🚫 {t('chat.thisDeleted')}</div>
                  ) : (
                    <>
                      {(m.attachment_path || m._file || m._preview) && (
                        <Attachment m={m} />
                      )}
                      {m.body && <div className="chat-body">{renderBody(m.body)}</div>}
                      {m.lead_id && (
                        <button className="chat-lead-chip" onClick={() => onOpenLead(m.lead_id)}>📎 {m.lead_label}</button>
                      )}
                    </>
                  )}

                  {/* للمديرين: النص الأصلي قبل الحذف/التعديل */}
                  {canMonitor && hist?.length > 0 && (
                    <div className="chat-hist">
                      <button onClick={() => setOpenHist(openHist === m.id ? null : m.id)}>
                        {m.deleted_at ? `👁 ${t('chat.deletedText')}` : `👁 ${t('chat.previousVersions')} (${hist.length})`}
                      </button>
                      {(openHist === m.id || m.deleted_at) && hist.map((h, k) => (
                        <div key={k} className="chat-hist-row">
                          <small>{h.action === 'delete' ? t('chat.beforeDelete') : t('chat.beforeEdit')} · {fmtTime(h.at)} {dayLabel(h.at)}</small>
                          <div>{h.old_body}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="chat-meta">
                    {m.edited_at && !m.deleted_at && <span>{t('chat.edited')}</span>}
                    <time>{fmtTime(m.created_at)}</time>
                    {m._status === 'uploading' && <span className="chat-tick" title={t('chat.att.uploading')}>⬆</span>}
                    {m._status === 'sending' && <span className="chat-tick" title={t('chat.sending')}>🕓</span>}
                    {rs && <span className={'chat-tick ' + rs}
                      title={rs === 'read' ? t('chat.read') : rs === 'partial' ? t('chat.readSome') : t('chat.sent')}>
                      {rs === 'sent' ? '✓' : '✓✓'}</span>}
                  </div>

                  {m._status === 'failed' && (
                    <div className="chat-failed" title={m._err}>
                      ⚠ {t('chat.notSent')}
                      <button onClick={() => deliver(m)}>{t('common.retry')}</button>
                      <button onClick={() => discard(m)}>{t('common.cancel')}</button>
                    </div>
                  )}

                  {!readOnly && !m.deleted_at && !m._status && (canWrite || (canPin && conv.kind === 'group')) && (
                    <button className="chat-msg-menu-btn" aria-label={t('chat.options')}
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id) }}>⋯</button>
                  )}
                  {menuFor === m.id && (
                    <div className="chat-msg-menu" onClick={e => e.stopPropagation()}>
                      {canWrite && <button onClick={() => { setMenuFor(null); setEditing(null); setReply(m); inputRef.current?.focus() }}>↩ {t('chat.reply')}</button>}
                      {canPin && conv.kind === 'group' && <button onClick={() => togglePin(m)}>📌 {conv.pinned_message_id === m.id ? t('chat.unpin') : t('chat.pin')}</button>}
                      {mine && m.body && canEditMsg(m) && <button onClick={() => startEdit(m)}>✎ {t('common.edit')}</button>}
                      {mine && <button className="danger" onClick={() => doDelete(m)}>🗑 {t('common.delete')}</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {canWrite && (
        <footer className="chat-composer">
          {(reply || editing) && (
            <div className="chat-compose-ctx">
              <span>{editing ? `✎ ${t('chat.editMessage')}` : `↩ ${t('chat.replyTo')} ${nameOf(reply.sender_id)}: ${reply.body ?? reply.lead_label ?? ''}`}</span>
              <button className="chat-icon-btn" onClick={() => { setReply(null); if (editing) { setEditing(null); setText('') } }}>✕</button>
            </div>
          )}
          {lead && (
            <div className="chat-compose-ctx">
              <span>📎 {lead.full_name}{lead.file_no ? ` · ${lead.file_no}` : ''}</span>
              <button className="chat-icon-btn" onClick={() => setLead(null)}>✕</button>
            </div>
          )}
          {att && (
            <div className="chat-compose-ctx chat-att-ctx">
              {att.preview ? <img src={att.preview} alt="" /> : <span>📄</span>}
              <span className="chat-att-name">{att.file.name}</span>
              <button className="chat-icon-btn" onClick={() => setAtt(null)}>✕</button>
            </div>
          )}
          {mention && mentionList.length > 0 && (
            <div className="chat-mention-list">
              {mentionList.map(p => (
                <button key={p.user_id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyMention(p)}>
                  <span className="chat-avatar">{(p.profiles?.full_name ?? '').trim()[0]}</span>
                  <span>{p.profiles?.full_name}</span><small>{dn(p.profiles?.roles)}</small>
                </button>
              ))}
            </div>
          )}
          {pickLead && (
            <LeadPicker onPick={(l) => { setLead(l); setPickLead(false); inputRef.current?.focus() }}
              onClose={() => setPickLead(false)} />
          )}
          {err && <div className="chat-err">{err}</div>}
          <div className="chat-compose-row">
            {!editing && (
              <>
                <button className="chat-icon-btn" title={t('chat.attachLead')} onClick={() => setPickLead(v => !v)}>📎</button>
                <button className="chat-icon-btn" title={t('chat.att.attach')} onClick={() => fileRef.current?.click()}>🖼</button>
                <input ref={fileRef} type="file" hidden accept="image/*,.pdf,.xlsx,.xls,.docx,.csv,.txt"
                  onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
              </>
            )}
            <textarea ref={inputRef} rows={1} value={text} maxLength={4000}
              onChange={onTextChange} onKeyDown={onKey} onPaste={onPaste}
              placeholder={conv.kind === 'group' ? t('chat.typePh') + ' — ' + t('chat.mentionHint') : t('chat.typePh')} />
            <button className="btn btn-primary chat-send" disabled={!text.trim() && !lead && !att} onClick={send}>
              {editing ? t('common.save') : t('chat.send')}
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
