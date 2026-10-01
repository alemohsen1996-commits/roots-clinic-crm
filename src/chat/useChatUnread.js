// عدّاد رسائل الشات غير المقروءة — للسايدبار والشريط العلوي وأيقونة الأبلكيشن
// بيتحدث محليًا من القناة اللحظية (من غير طلب للسيرفر مع كل رسالة)
// + صوت تنبيه خفيف لو الرسالة في محادثة مش مفتوحة قدام الموظف
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUnreadTotal } from './chatApi'
import { connectChat, disconnectChat, onChat, watchingConv } from './chatRealtime'

let audioCtx = null
function ding() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const t = audioCtx.currentTime
    ;[880, 1320].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.12)
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18)
      o.connect(g).connect(audioCtx.destination)
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2)
    })
  } catch {}
}

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
          if (document.visibilityState === 'visible') ding()
        }
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
