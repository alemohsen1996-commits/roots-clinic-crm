// عدّاد رسائل الشات غير المقروءة — للسايدبار والشريط العلوي وأيقونة الأبلكيشن
// بيتحدث محليًا من القناة اللحظية (من غير طلب للسيرفر مع كل رسالة)
// + صوت تنبيه مميز لو الرسالة في محادثة مش مفتوحة قدام الموظف، وصوت تاني لما حد يتفاعل على رسالتي
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMessage, fetchUnreadTotal } from './chatApi'
import { playSound } from '../lib/sounds'
import { connectChat, disconnectChat, onChat, watchingConv } from './chatRealtime'

// متوافق مع الاستخدام القديم (جرس الإشعارات)
export const ding = () => playSound('notify')

export function useChatUnread(userId, isMonitor) {
  const [count, setCount] = useState(0)
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!userId) return
    setCount(await fetchUnreadTotal())
  }, [userId])

  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 300)
  }, [load])

  useEffect(() => {
    connectChat(userId, isMonitor)
    return () => disconnectChat()
  }, [userId, isMonitor])

  useEffect(() => {
    if (!userId) return
    load()
    const off = onChat((event, p) => {
      if (event === 'msg_new' && p.sender_id !== userId) {
        if (!watchingConv(p.conversation_id)) {
          setCount(c => c + 1)
          playSound('message')
        }
      } else if (event === 'reaction' && p.emoji && p.user_id !== userId) {
        // صوت بس لو الرسالة بتاعتي
        fetchMessage(p.message_id).then(m => { if (m?.sender_id === userId) playSound('reaction') }).catch(() => {})
      } else if (
        (event === 'read' && p.user_id === userId) || event === 'members' || event === 'resync' ||
        (event === 'msg_update' && p.deleted_at && p.sender_id !== userId)
      ) soon()
    })
    const t = setInterval(load, 120000)
    const onVis = () => { if (document.visibilityState === 'visible') soon() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('chat:read', soon)
    return () => {
      off(); clearInterval(t); clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('chat:read', soon)
    }
  }, [userId, load, soon])

  // الرقم على أيقونة الأبلكيشن (PWA)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (count > 0) navigator.setAppBadge(count).catch(() => {})
    else navigator.clearAppBadge?.().catch(() => {})
  }, [count])

  return count
}
