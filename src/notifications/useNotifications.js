// إشعارات الموظف — صفحات من 10 + فلتر (الكل / غير المقروء) + عدد غير المقروء
// التحديث اللحظي من نفس قناة الشات الخاصة (حدث 'notif' بيتبعت من الداتابيز)،
// وبنعيد الجلب بدل ما نثق في الـ payload: الإسنادات المجمّعة بتتعدّل في نفس الصف
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { onChat } from '../chat/chatRealtime'
import { ding } from '../chat/useChatUnread'

export const NOTIF_PAGE = 10
const COLS = 'id, type, title, body, entity, entity_id, data, is_read, group_count, created_at, updated_at'

export function useNotifications(userId) {
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [total, setTotal] = useState(0)
  const [filter, setFilterState] = useState('all')     // all | unread
  const [limit, setLimit] = useState(NOTIF_PAGE)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  // آخر قيم للفلتر والحد — عشان الجلب من القناة اللحظية يستخدمها من غير ما يعيد الاشتراك
  const view = useRef({ filter: 'all', limit: NOTIF_PAGE })
  view.current = { filter, limit }

  const load = useCallback(async ({ sound = false } = {}) => {
    if (!userId) return
    const { filter: f, limit: lim } = view.current
    setLoading(true)
    let q = supabase.from('notifications').select(COLS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(lim + 1)                                  // صف زيادة = فيه «عرض المزيد»
    if (f === 'unread') q = q.eq('is_read', false)
    const [list, un, all] = await Promise.all([
      q,
      supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_read', false),
      supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ])
    setLoading(false)
    if (list.error) { console.error(list.error); return }
    const rows = list.data ?? []
    setHasMore(rows.length > lim)
    setItems(rows.slice(0, lim))
    setUnread(un.count ?? 0)
    setTotal(all.count ?? 0)
    if (sound && document.visibilityState === 'visible') ding()
  }, [userId])

  const soon = useCallback((opts) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => load(opts), 400)
  }, [load])

  useEffect(() => {
    if (!userId) return
    const off = onChat((event) => {
      if (event === 'notif') soon({ sound: true })
      else if (event === 'resync') soon()
    })
    const iv = setInterval(load, 300000)   // احتياطي لو القناة وقعت
    const onVis = () => { if (document.visibilityState === 'visible') soon() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      off(); clearInterval(iv); clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userId, load, soon])

  // أول تحميل + تغيير الفلتر أو الحد → جلب جديد
  useEffect(() => { load() }, [filter, limit, load])

  const setFilter = useCallback((f) => { setLimit(NOTIF_PAGE); setFilterState(f) }, [])
  const loadMore = useCallback(() => setLimit(l => l + NOTIF_PAGE), [])
  // يرجّع اللوحة لأول صفحة (عند فتحها من جديد)
  const resetView = useCallback(() => { setLimit(NOTIF_PAGE); setFilterState('all') }, [])

  const markRead = useCallback(async (id) => {
    let changed = false
    setItems(list => list.map(n => {
      if (n.id !== id || n.is_read) return n
      changed = true
      return { ...n, is_read: true }
    }))
    if (changed) setUnread(u => Math.max(0, u - 1))
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    if (error) { console.error(error); load() }
  }, [load])

  const markAllRead = useCallback(async () => {
    setItems(list => list.map(n => ({ ...n, is_read: true })))
    setUnread(0)
    const { error } = await supabase.rpc('notif_mark_all_read')
    if (error) console.error(error)
    load()
  }, [load])

  const remove = useCallback(async (id) => {
    const target = items.find(n => n.id === id)
    setItems(list => list.filter(n => n.id !== id))
    setTotal(c => Math.max(0, c - 1))
    if (target && !target.is_read) setUnread(u => Math.max(0, u - 1))
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) console.error(error)
    load()   // يجيب اللي بعده عشان الصفحة تفضل مليانة
  }, [items, load])

  const clearAll = useCallback(async () => {
    setItems([]); setUnread(0); setTotal(0); setHasMore(false)
    const { error } = await supabase.rpc('notif_clear_all')
    if (error) { console.error(error); load() }
  }, [load])

  return {
    items, unread, total, filter, hasMore, loading,
    setFilter, loadMore, resetView, markRead, markAllRead, remove, clearAll, reload: load,
  }
}
