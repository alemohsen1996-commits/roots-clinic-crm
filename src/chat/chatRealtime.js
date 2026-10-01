// قناة لحظية واحدة لكل موظف (Broadcast خاص) — كل شاشات الشات بتسمع منها
// الأحداث: msg_new | msg_update | read | members | activity (المراقبة) | resync (بعد إعادة الاتصال)
import { supabase } from '../lib/supabase'

const listeners = new Set()
let channels = []
let key = null

const emit = (event, payload) => listeners.forEach(fn => { try { fn(event, payload ?? {}) } catch (e) { console.error(e) } })

export async function connectChat(userId, isMonitor) {
  const k = userId ? `${userId}:${isMonitor ? 1 : 0}` : null
  if (k === key) return
  disconnectChat()
  key = k
  if (!userId) return
  await supabase.realtime.setAuth()   // القنوات الخاصة محتاجة توكن الموظف
  if (key !== k) return

  const open = (topic) => {
    let joined = false
    return supabase.channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, ({ event, payload }) => emit(event, payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          // أول اشتراك مش محتاج مزامنة، لكن أي إعادة اتصال ممكن تكون فوّتت رسايل
          if (joined) emit('resync')
          joined = true
        }
        if (status === 'CHANNEL_ERROR') console.error('[chat realtime]', topic, err)
      })
  }
  channels = [open('chat:u:' + userId)]
  if (isMonitor) channels.push(open('chat:monitor'))
}

export function disconnectChat() {
  channels.forEach(c => supabase.removeChannel(c))
  channels = []
  key = null
}

export function onChat(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// الموظف فاتح المحادثة دي قدامه دلوقتي؟
export const watchingConv = (convId) =>
  document.visibilityState === 'visible' &&
  location.pathname === '/chat' && new URLSearchParams(location.search).get('c') === convId
