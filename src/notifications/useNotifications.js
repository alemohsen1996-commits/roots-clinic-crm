// إشعارات الموظف — آخر 30 + عدد غير المقروء
// التحديث اللحظي من نفس قناة الشات الخاصة (حدث 'notif' بيتبعت من الداتابيز)،
// وبنعيد الجلب بدل ما نثق في الـ payload: الإسنادات المجمّعة بتتعدّل في نفس الصف
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { onChat } from '../chat/chatRealtime'
import { ding } from '../chat/useChatUnread'

const LIMIT = 30
const COLS = 'id, type, title, body, entity, entity_id, data, is_read, group_count, created_at, updated_at'

export function useNotifications(userId) {
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const timer = useRef(null)

  const load = useCallback(async ({ sound = false } = {}) => {
    if (!userId) return
    const [list, cnt] = await Promise.all([
      supabase.from('notifications').select(COLS)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(LIMIT),
      supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_read', false),
    ])
    if (list.error) { console.error(list.error); return }
    setItems(list.data ?? [])
    setUnread(cnt.count ?? 0)
    if (sound && document.visibilityState === 'visible') ding()
  }, [userId])

  const soon = useCallback((opts) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => load(opts), 400)
  }, [load])

  useEffect(() => {
    if (!userId) return
    load()
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
    if (error) { console.error(error); load() }
  }, [load])

  return { items, unread, markRead, markAllRead, reload: load }
}
