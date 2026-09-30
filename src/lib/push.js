// إشعارات Web Push — تسجيل الـ Service Worker والاشتراك/الإلغاء
// المفتاح العام VAPID مش سر (الخاص في Vault ومستخدم في Edge Function «chat-push» بس)
import { supabase } from './supabase'

export const VAPID_PUBLIC = 'BDcz-z52IS1F2zkTcL7qSc4tmWiGWhuHqAw_F1ogsBUpzd0kH62ijnA45L8ZxPhwoLjpXavxtnl0M4Ab_0oqHsA'

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

let regPromise = null
export function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!regPromise) {
    regPromise = navigator.serviceWorker.register('/sw.js').catch(e => { console.error('[sw]', e); return null })
  }
  return regPromise
}

async function currentSub() {
  const reg = await registerSW()
  return reg ? reg.pushManager.getSubscription() : null
}

async function saveSub(sub) {
  const j = sub.toJSON()
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent,
  })
  if (error) throw error
}

// الحالة: unsupported | ios-install | denied | off | on
export async function getPushState() {
  if (isIOS() && !isStandalone()) return 'ios-install'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await currentSub()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export async function enablePush() {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = await registerSW()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) })
  }
  await saveSub(sub)
  return 'on'
}

export async function disablePush() {
  const sub = await currentSub()
  if (sub) {
    await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint })
    await sub.unsubscribe().catch(() => {})
  }
  return 'off'
}

// بعد الدخول: لو الجهاز مشترك نربطه بالموظف الحالي (ممكن يكون حد تاني كان داخل عليه)
export async function syncPushOnLogin() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    const sub = await currentSub()
    if (sub) await saveSub(sub)
  } catch (e) { console.error('[push] sync', e) }
}

// قبل الخروج: نفصل الجهاز عن الموظف عشان إشعاراته ما توصلش لحد تاني
export async function unlinkPushOnLogout() {
  try {
    const sub = await currentSub()
    if (sub) await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint })
  } catch {}
}
