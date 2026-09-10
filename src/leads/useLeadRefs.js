// جالب البيانات المرجعية + دوال جلب مقسّمة (pagination) على مستوى القاعدة
// مصمّم ليتحمّل عشرات الآلاف من الليدات بدون تعليق المتصفح
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useLeadRefs() {
  const [stages, setStages] = useState([])
  const [sources, setSources] = useState([])
  const [agents, setAgents] = useState([])
  const [lostReasons, setLostReasons] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('stages').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('*').eq('is_active', true),
      supabase.from('profiles').select('id, full_name').eq('status', 'active'),
      supabase.from('lost_reasons').select('*').eq('is_active', true),
    ]).then(([st, so, ag, lr]) => {
      setStages(st.data ?? [])
      setSources(so.data ?? [])
      setAgents(ag.data ?? [])
      setLostReasons(lr.data ?? [])
      setReady(true)
    })
  }, [])

  return { stages, sources, agents, lostReasons, ready }
}

// نجلب التاسكات المفتوحة مع كل ليد (لحساب الإشعار على الكارت)
const LEAD_COLUMNS = `
  id, file_no, full_name, phone, country, city, source_id, stage_id,
  owner_id, coordinator_id, attempts, last_activity, created_at, procedure_interest,
  snooze_until, follow_paused, archived_at,
  stages(code, name_ar, color, category, board),
  lead_sources(name_ar),
  owner:profiles!leads_owner_id_fkey(full_name),
  tasks(id, due_at, status)
`

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate()-n); return d }

function applyFilters(q, filters) {
  // إخفاء المؤرشفة افتراضيًا (إلا عند طلب عرض الأرشيف)
  if (filters.showArchived) { q = q.not('archived_at', 'is', null) }
  else { q = q.is('archived_at', null) }

  if (filters.source) q = q.eq('source_id', filters.source)
  if (filters.owner)  q = q.eq('owner_id', filters.owner)
  if (filters.branch) q = q.eq('branch_id', filters.branch)
  if (filters.interest) q = q.eq('procedure_interest', filters.interest)
  if (filters.search) {
    const s = filters.search.trim()
    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,file_no.ilike.%${s}%`)
  }

  // تاريخ الإنشاء
  if (filters.createdFrom) q = q.gte('created_at', filters.createdFrom)
  if (filters.createdTo) {
    const to = new Date(filters.createdTo); to.setHours(23,59,59,999)
    q = q.lte('created_at', to.toISOString())
  }

  // اتحرّك النهاردة
  if (filters.movedToday) q = q.gte('last_activity', startOfToday().toISOString())

  // راكدة: مفيش حركة من 7 أيام
  if (filters.stale) q = q.lt('last_activity', daysAgo(7).toISOString())

  // موقوفة المتابعة
  if (filters.paused) q = q.eq('follow_paused', true)

  // بدون مسؤول (Pool)
  if (filters.noOwner) q = q.is('owner_id', null)

  // اتحوّلولي اليوم (للمنسقة): coordinator_id = المستخدم، والتحويل اليوم
  // نطبّق coordinator_id في الاستدعاء، وهنا شرط اليوم على آخر نشاط كتقريب
  if (filters.transferredToday) q = q.gte('last_activity', startOfToday().toISOString())
  if (filters.coordinatorId) q = q.eq('coordinator_id', filters.coordinatorId)

  // مؤجّلة لبكرة
  if (filters.snoozed) q = q.gt('snooze_until', new Date().toISOString())

  // السعر المعروض
  if (filters.priceFrom) q = q.gte('offered_price', Number(filters.priceFrom))
  if (filters.priceTo)   q = q.lte('offered_price', Number(filters.priceTo))

  // العمر
  if (filters.ageFrom) q = q.gte('age', Number(filters.ageFrom))
  if (filters.ageTo)   q = q.lte('age', Number(filters.ageTo))

  return q
}

// هل الفلاتر تتضمّن شرطًا معتمدًا على التاسكات؟
export function hasTaskFilter(f = {}) {
  return !!(f.alertOnly || f.taskToday || f.taskOverdue || f.noTask)
}

// معرّفات الليدات المطابقة لفلاتر التاسكات — تُحسب في القاعدة
// (كانت تُحسب في المتصفح على الصفحة المعروضة فقط فيختلّ العدّ)
async function taskFilteredIds(filters) {
  const ids = []
  for (let off = 0; off < 100000; off += 1000) {
    let q = supabase.from('v_lead_flags').select('lead_id')
    if (filters.alertOnly)   q = q.gt('alert_days', 0)
    if (filters.taskToday)   q = q.eq('task_today', true)
    if (filters.taskOverdue) q = q.eq('task_overdue', true)
    if (filters.noTask)      q = q.eq('open_tasks', 0)
    const { data, error } = await q.range(off, off + 999)
    if (error) { console.error(error); break }
    ids.push(...(data ?? []).map(r => r.lead_id))
    if ((data ?? []).length < 1000) break
  }
  return ids
}

// المراحل التي لا تحتاج متابعة (لا إشعار فيها إطلاقًا)
const QUIET_STAGES = ['dead', 'lost', 'done', 'won']

// يحسب إشعار الليد: عدد أيام التأخير (0 = لا إشعار)
// يحترم: إيقاف المتابعة، التأجيل لبكرة، المراحل الميتة، التاسك المجدول
export function computeAlert(lead) {
  const now = Date.now()
  const DAY = 86400000

  // 1) متابعة موقوفة نهائيًا → لا إشعار
  if (lead.follow_paused) return 0

  // 2) مرحلة لا تحتاج متابعة (ميت/خسارة/تمت) → لا إشعار
  const code = lead.stages?.code
  if (code && QUIET_STAGES.includes(code)) return 0

  // 3) مؤجّل لوقت لم يأتِ بعد → لا إشعار
  if (lead.snooze_until && new Date(lead.snooze_until).getTime() > now) return 0

  const openTasks = (lead.tasks ?? []).filter(t => t.status === 'open')

  if (openTasks.length > 0) {
    const soonest = Math.min(...openTasks.map(t => new Date(t.due_at).getTime()))
    if (soonest > now) return 0                 // الموعد لم يحن بعد
    const days = Math.floor((now - soonest) / DAY)
    return days < 1 ? 1 : days
  }

  // لا تاسك: أيام الإهمال منذ آخر نشاط
  const last = lead.last_activity ? new Date(lead.last_activity).getTime() : now
  const days = Math.floor((now - last) / DAY)
  return days > 0 ? days : 0
}

// فلاتر تُطبّق محليًا على النتائج (تعتمد على التاسكات أو حساب الإشعار)
export function applyLocalFilters(rows, filters) {
  let r = rows
  if (filters.alertOnly)  r = r.filter(l => computeAlert(l) > 0)
  if (filters.taskToday)  r = r.filter(l => hasTaskDueToday(l))
  if (filters.taskOverdue) r = r.filter(l => hasTaskOverdue(l))
  if (filters.noTask)     r = r.filter(l => !(l.tasks ?? []).some(t => t.status === 'open'))
  return r
}

function hasTaskDueToday(lead) {
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(); end.setHours(23,59,59,999)
  return (lead.tasks ?? []).some(t =>
    t.status === 'open' &&
    new Date(t.due_at) >= start && new Date(t.due_at) <= end)
}

function hasTaskOverdue(lead) {
  const now = Date.now()
  return (lead.tasks ?? []).some(t =>
    t.status === 'open' && new Date(t.due_at).getTime() < now)
}

// ---------- الجدول: صفحة واحدة + إجمالي العدد ----------
export async function fetchLeadsPage({ boardStageIds, filters = {}, page = 0, pageSize = 50 }) {
  const from = page * pageSize
  const to = from + pageSize - 1

  // فلاتر التاسكات تُحوَّل إلى قائمة معرّفات قبل الاستعلام
  let taskIds = null
  if (hasTaskFilter(filters)) {
    taskIds = await taskFilteredIds(filters)
    if (!taskIds.length) return { rows: [], total: 0 }
  }

  let q = supabase
    .from('leads')
    .select(LEAD_COLUMNS, { count: 'exact' })
    .in('stage_id', boardStageIds)
    .order('last_activity', { ascending: false })
    .range(from, to)

  if (filters.stage) q = q.eq('stage_id', filters.stage)
  if (taskIds) q = q.in('id', taskIds)
  q = applyFilters(q, filters)

  const { data, count, error } = await q
  if (error) console.error(error)
  return { rows: data ?? [], total: count ?? 0 }
}

// ---------- الكانبان: لكل مرحلة، أحدث N ليد + العدد الحقيقي ----------
export async function fetchStageColumn({ stageId, filters = {}, limit = 50 }) {
  let taskIds = null
  if (hasTaskFilter(filters)) {
    taskIds = await taskFilteredIds(filters)
    if (!taskIds.length) return { rows: [], total: 0 }
  }

  let countQ = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId)
  if (taskIds) countQ = countQ.in('id', taskIds)
  countQ = applyFilters(countQ, filters)
  const { count } = await countQ

  let dataQ = supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('stage_id', stageId)
    .order('last_activity', { ascending: false })
    .limit(limit)
  if (taskIds) dataQ = dataQ.in('id', taskIds)
  dataQ = applyFilters(dataQ, filters)
  const { data } = await dataQ

  return { rows: data ?? [], total: count ?? 0 }
}
