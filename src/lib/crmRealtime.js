// التحديث اللحظي للّيدات والدفعات والمعاينات (Broadcast من الداتابيز)
// الداتابيز بتبعت إشعار صغير (أرقام بس) لأصحاب الصلاحية — والصفحة بتعيد الجلب بنفسها تحت الـ RLS.
// القنوات:
//   chat:u:<id>       قناة الموظف الخاصة (مفتوحة أصلًا من الشات) — أحداث crm_* بتعدّي من هنا
//   crm:role:<دور>    كل موظفين الدور (المديرين، المحاسب، المنسقات، السيلز…)
//   crm:all           الليدات اللي في الـ Pool (من غير صاحب) — أي موظف مفعّل
// الأحداث: crm_leads {id, stage_id, old_stage_id, op} | crm_payments {id, deal_id, op}
//          crm_appts {id, op} | resync (بعد إعادة اتصال — ممكن يكون فاتنا أحداث)
import { supabase } from './supabase'
import { onChat } from '../chat/chatRealtime'

const listeners = new Set()
let channels = []
let key = null

const emit = (event, payload) => listeners.forEach(fn => {
  try { fn(event, payload ?? {}) } catch (e) { console.error(e) }
})

// قناة الموظف الخاصة بيديرها الشات — بناخد منها أحداث crm_* وإعادة الاتصال
onChat((event, payload) => {
  if (event.startsWith('crm_')) emit(event, payload)
  else if (event === 'resync') emit('resync')
})

export async function connectCrm(userId, roleCode) {
  const k = userId && roleCode ? `${userId}:${roleCode}` : null
  if (k === key) return
  disconnectCrm()
  key = k
  if (!k) return
  await supabase.realtime.setAuth()
  if (key !== k) return

  const open = (topic) => {
    let joined = false
    return supabase.channel(topic, { config: { private: true } })
      .on('broadcast', { event: '*' }, ({ event, payload }) => emit(event, payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (joined) emit('resync')
          joined = true
        }
        if (status === 'CHANNEL_ERROR') console.error('[crm realtime]', topic, err)
      })
  }
  channels = [open('crm:role:' + roleCode), open('crm:all')]
}

export function disconnectCrm() {
  channels.forEach(c => supabase.removeChannel(c))
  channels = []
  key = null
}

export function onCrm(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
