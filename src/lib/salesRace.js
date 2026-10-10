// سباق السيلز — المركز الأول والتاني بعدد العمليات اللي تمت في الشهر الحالي
// مخزن واحد للتطبيق كله (الميداليات بتظهر في أماكن كتير — الشات، ملف الليد، لوحة التحكم…)
// الداتابيز بتبعت crm_race مع أي تغيير في عملية تمت → نعيد الجلب
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { onCrm } from './crmRealtime'

const EMPTY = { ready: false, month: null, first: null, second: null, me: null }
let state = EMPTY
let userKey = null
let timer = null
let started = false
const subs = new Set()

const emit = () => subs.forEach(fn => fn())

async function load() {
  const key = userKey
  if (!key) return
  const { data, error } = await supabase.rpc('sales_race')
  if (key !== userKey) return               // اتغيّر المستخدم في النص
  if (error) { console.error('[sales race]', error); return }
  state = { ...EMPTY, ...(data ?? {}), ready: true }
  emit()
}

function soon() {
  clearTimeout(timer)
  timer = setTimeout(load, 600)
}

function startListeners() {
  if (started) return
  started = true
  onCrm((event) => { if (event === 'crm_race' || event === 'resync') soon() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') soon()
  })
  setInterval(load, 10 * 60 * 1000)          // احتياطي (وبيلقط بداية الشهر الجديد)
}

// بيتنادى من الـ Shell بعد الدخول (ومع تغيير المستخدم)
export function connectSalesRace(userId) {
  if (userId === userKey) return
  userKey = userId ?? null
  state = EMPTY
  emit()
  if (!userKey) return
  startListeners()
  load()
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn) }
const snapshot = () => state

export function useSalesRace() {
  return useSyncExternalStore(subscribe, snapshot)
}

// 1 = الأول، 2 = التاني، null = مالوش ميدالية
export function medalOf(race, userId) {
  if (!userId || !race) return null
  if (race.first?.id === userId) return 1
  if (race.second?.id === userId) return 2
  return null
}
