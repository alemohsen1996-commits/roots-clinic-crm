// عدّاد رسائل الشات غير المقروءة — للسايدبار والشريط العلوي وأيقونة الأبلكيشن
// بيتحدث لحظيًا مع أي رسالة جديدة (Realtime) + كل دقيقة احتياطيًا
// + صوت تنبيه خفيف لو الرسالة في محادثة مش مفتوحة قدام الموظف
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchUnreadTotal } from './chatApi'

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

const watchingConv = (convId) =>
  document.visibilityState === 'visible' &&
  location.pathname === '/chat' && new URLSearchParams(location.search).get('c') === convId

export function useChatUnread(userId) {
  const [count, setCount] = useState(0)
  const countRef = useRef(0)
  countRef.current = count
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!userId) return
    setCount(await fetchUnreadTotal())
  }, [userId])

  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 400)
  }, [load])

  useEffect(() => {
    if (!userId) return
    load()
    const ch = supabase.channel('chat-unread-' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new
        if (!m || m.sender_id === userId) return
        soon()
        // المراقب بيوصله كل الرسائل عبر Realtime — الصوت لما يكون الرقم فعلًا زاد
        const before = countRef.current
        setTimeout(async () => {
          const now = await fetchUnreadTotal()
          if (now > before && document.visibilityState === 'visible' && !watchingConv(m.conversation_id)) ding()
        }, 500)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_participants',
            filter: `user_id=eq.${userId}` }, soon)
      .subscribe()
    const t = setInterval(load, 60000)
    window.addEventListener('chat:read', soon)
    return () => {
      clearInterval(t); clearTimeout(timer.current)
      window.removeEventListener('chat:read', soon)
      supabase.removeChannel(ch)
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
