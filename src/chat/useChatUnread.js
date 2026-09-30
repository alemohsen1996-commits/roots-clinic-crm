// عدّاد رسائل الشات غير المقروءة — للسايدبار والشريط العلوي
// بيتحدث لحظيًا مع أي رسالة جديدة (Realtime) + كل دقيقة احتياطيًا
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchUnreadTotal } from './chatApi'

export function useChatUnread(userId) {
  const [count, setCount] = useState(0)
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!userId) return
    setCount(await fetchUnreadTotal())
  }, [userId])

  // تجميع الأحداث المتتالية في طلب واحد
  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 400)
  }, [load])

  useEffect(() => {
    if (!userId) return
    load()
    const ch = supabase.channel('chat-unread-' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        if (p.new?.sender_id !== userId) soon()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_participants',
            filter: `user_id=eq.${userId}` }, soon)
      .subscribe()
    const t = setInterval(load, 60000)
    // صفحة الشات بتبلّغنا لما تعلّم محادثة كمقروءة
    window.addEventListener('chat:read', soon)
    return () => {
      clearInterval(t); clearTimeout(timer.current)
      window.removeEventListener('chat:read', soon)
      supabase.removeChannel(ch)
    }
  }, [userId, load, soon])

  return count
}
