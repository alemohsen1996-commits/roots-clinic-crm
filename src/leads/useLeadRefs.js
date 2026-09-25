// جالب البيانات المرجعية + دوال جلب مقسّمة (pagination) على مستوى القاعدة
// مصمّم ليتحمّل عشرات الآلاف من الليدات بدون تعليق المتصفح
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { QUIET_STAGES } from '../lib/stageCodes'

export function useLeadRefs() {
  const [stages, setStages] = useState([])
  const [sources, setSources] = useState([])
  const [agents, setAgents] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [lostReasons, setLostReasons] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('stages').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('*').eq('is_active', true),
      supabase.from('profiles')
        .select('id, full_name, roles(code)').eq('status', 'active'),
      supabase.from('lost_reasons').select('*').eq('is_active', true),
    ]).then(([st, so, ag, lr]) => {
      setStages(st.data ?? [])
      setSources(so.data ?? [])
      const people = ag.data ?? []
      setAgents(people)
      setCoordinators(people.filter(p => p.roles?.code === 'coordinator'))
      setLostReasons(lr.data ?? [])
      setReady(true)
    })
  }, [])

  return { stages, sources, agents, coordinators, lostReasons, ready }
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
  // فلتر المنسقة — مستقل عن مالك الليد (السيلز)
  if (filters.coordinator) q = q.eq('coordinator_id', filters.coordinator)
  if (filters.branch) q = q.eq('branch_id', filters.branch)
  if (filters.interest) q = q.eq('procedure_interest', filters.interest)
  if (filters.search) {
    const s = filters.search.trim()
    // أرقام فقط من نص البحث — للمطابقة على phone_norm (المخزّن بلا + أو مسافات)
    let digits = s.replace(/\D/g, '')
    // توحيد الصيغة المحلية مع المخزّن (كله بكود الدولة 966…):
    // 00 = بادئة اتصال دولي، و 0 = بادئة محلية سعودية → نزيلها فيطابق الرقم بالكود
    if (digits.startsWith('00')) digits = digits.slice(2)
    else if (digits.startsWith('0')) digits = digits.slice(1)
    // هل يوجد حرف (عربي/لاتيني)؟ أي شيء غير رقم أو علامات الهاتف المعتادة
    const hasLetters = /[^\d\s+()\-.,]/.test(s)

    const ors = []
    if (hasLetters) {
      ors.push(`full_name.ilike.%${s}%`)
      ors.push(`file_no.ilike.%${s}%`)
    }
    if (digits.length >= 3) {
      // بحث بالأرقام على العمود المطبّع — يطابق كل الأشكال: +، مسافات، أو بدون كود دولة
      ors.push(`phone_norm.ilike.%${digits}%`)
      ors.push(`file_no.ilike.%${digits}%`)
    }
    // احتياطي: مدخل قصير بلا حروف ولا 3 أرقام — ابحث بالاسم ورقم الملف كما هو
    if (ors.length === 0) {
      ors.push(`full_name.ilike.%${s}%`, `file_no.ilike.%${s}%`)
    }
    q = q.or(ors.join(','))
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

// ---------- فلاتر الفترات (حركة/مكالمات) — بتتحسب في القاعدة عبر RPC ----------
// leads_activity_filter / lead_flags_activity_filter بيرجعوا setof صفوف،
// فبنكمّل عليهم نفس الـ select/الفلاتر/الترتيب/العدّ بتاع الجدول بالظبط
export function hasRangeFilter(f = {}) {
  const has = (v) => v !== '' && v != null
  return !!(f.movedFrom || f.movedTo || has(f.callsMin) || has(f.callsMax)
    || f.callsFrom || f.callsTo || f.callsAnswered)
}
const dayStart = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd) }
const dayEnd = (d) => { const x = dayStart(d); x.setDate(x.getDate() + 1); return x }   // حصري

function rangeParams(f) {
  const has = (v) => v !== '' && v != null
  // بنبعت بس القيم الموجودة — الباقي بياخد null الافتراضي في الدالة
  const p = {}
  if (f.movedFrom) p.p_moved_from = dayStart(f.movedFrom).toISOString()
  if (f.movedTo)   p.p_moved_to   = dayEnd(f.movedTo).toISOString()
  if (f.callsFrom) p.p_calls_from = dayStart(f.callsFrom).toISOString()
  if (f.callsTo)   p.p_calls_to   = dayEnd(f.callsTo).toISOString()
  if (has(f.callsMin)) p.p_min_calls = Number(f.callsMin)
  if (has(f.callsMax)) p.p_max_calls = Number(f.callsMax)
  // تاريخ مكالمات (أو «اتردّ عليها بس») من غير عدد = «اتكلّم مرة على الأقل في الفترة»
  if (!has(f.callsMin) && !has(f.callsMax) && (f.callsFrom || f.callsTo || f.callsAnswered)) p.p_min_calls = 1
  if (f.callsAnswered) p.p_answered_only = true
  return p
}

// head:true في rpc بيحوّل الطلب لـ HEAD والمعاملات للرابط — فبدلها: صف واحد + count
function rangeRpc(fn, filters, columns, opts = {}) {
  const { head, ...rest } = opts
  const q = supabase.rpc(fn, rangeParams(filters), rest).select(columns)
  return head ? q.range(0, 0) : q
}

// نقطة البداية لأي استعلام ليدز: الجدول مباشرة، أو الـ RPC لو فيه فلتر فترة
function leadsFrom(filters, columns, opts) {
  if (hasRangeFilter(filters)) return rangeRpc('leads_activity_filter', filters, columns, opts)
  return supabase.from('leads').select(columns, opts)
}

// نفس الفكرة لـ v_lead_flags (فلاتر التاسكات) — عشان صفحة/عدّ فلاتر التاسكات يحترموا الفترة
function flagsFrom(filters, columns, opts) {
  if (hasRangeFilter(filters)) return rangeRpc('lead_flags_activity_filter', filters, columns, opts)
  return supabase.from('v_lead_flags').select(columns, opts)
}

// هل الفلاتر تتضمّن شرطًا معتمدًا على التاسكات؟
export function hasTaskFilter(f = {}) {
  return !!(f.alertOnly || f.taskToday || f.taskOverdue || f.noTask)
}

// يطبّق شروط فلاتر التاسكات على استعلام v_lead_flags
function applyFlagConds(q, filters) {
  if (filters.alertOnly)   q = q.gt('alert_days', 0)
  if (filters.taskToday)   q = q.eq('task_today', true)
  if (filters.taskOverdue) q = q.eq('task_overdue', true)
  if (filters.noTask)      q = q.eq('open_tasks', 0)
  return q
}

// حصر نطاق استعلامات v_lead_flags (يتخطّى الـ RLS) لِما يراه المستخدم فعلًا:
// المدير = الكل، المنسقة = مرضاها، السيلز = ليداته + غير المُسندة — مطابق لـ chip_counts.
function applyOwnerScope(q, filters) {
  if (filters.mineCoordinator) return q.eq('coordinator_id', filters.mineCoordinator)
  if (filters.mineOwner) return q.or(`owner_id.eq.${filters.mineOwner},owner_id.is.null`)
  return q
}

// معرّفات الليدات المطابقة لفلاتر التاسكات داخل مراحل محددة، مع صفحة/ترتيب.
// نجلب من v_lead_flags مباشرة (فيه stage_id و archived_at) بدل تمرير آلاف
// المعرّفات عبر .in() التي تُقطع عند ~1000 فتختفي نتائج.
async function flagLeadIds({ stageIds, filters, from = 0, to = null, sort = 'recent' }) {
  let q = flagsFrom(filters, 'lead_id, next_due')
    .in('stage_id', stageIds)
  // الـ view صار يحوي كل أعمدة الفلترة، فنطبّق الفلاتر كاملةً هنا —
  // بذلك يتطابق ترقيم الصفحة مع أي فلتر مدموج (مصدر/بحث/تاريخ…).
  // applyFilters يضيف شرط archived_at بنفسه (is null افتراضيًا).
  q = applyFilters(q, filters)
  q = applyFlagConds(q, filters)
  q = applyOwnerScope(q, filters)
  q = q.order('next_due', { ascending: sort !== 'recent', nullsFirst: false })
  if (to !== null) q = q.range(from, to)
  const { data, error } = await q
  if (error) { console.error(error); return [] }
  return (data ?? []).map(r => r.lead_id)
}

async function flagCount({ stageIds, filters }) {
  let q = flagsFrom(filters, 'lead_id', { count: 'exact', head: true })
    .in('stage_id', stageIds)
  // نفس الفلاتر الكاملة على العدّ — فيتساوى total مع عدد صفوف الصفحة
  q = applyFilters(q, filters)
  q = applyFlagConds(q, filters)
  q = applyOwnerScope(q, filters)
  const { count } = await q
  return count ?? 0
}


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
  const stageIds = filters.stage ? [Number(filters.stage)] : boardStageIds

  // مع فلاتر التاسكات: نصفّح ونعدّ من v_lead_flags مباشرة،
  // ثم نجلب بيانات صفحة الليدات فقط (قائمة قصيرة آمنة لـ .in)
  if (hasTaskFilter(filters)) {
    const total = await flagCount({ stageIds, filters })
    if (!total) return { rows: [], total: 0 }
    const pageIds = await flagLeadIds({ stageIds, filters, from, to, sort: 'recent' })
    if (!pageIds.length) return { rows: [], total }

    let q = leadsFrom(filters, LEAD_COLUMNS).in('id', pageIds)
    q = applyFilters(q, filters)
    const { data, error } = await q
    if (error) console.error(error)
    // الحفاظ على ترتيب pageIds
    const order = Object.fromEntries(pageIds.map((id, i) => [id, i]))
    const rows = (data ?? []).sort((a, b) => order[a.id] - order[b.id])
    return { rows, total }
  }

  let q = leadsFrom(filters, LEAD_COLUMNS, { count: 'exact' })
    .in('stage_id', boardStageIds)
    .order('last_activity', { ascending: false })
    .range(from, to)

  if (filters.stage) q = q.eq('stage_id', filters.stage)
  q = applyFilters(q, filters)

  const { data, count, error } = await q
  if (error) console.error(error)
  return { rows: data ?? [], total: count ?? 0 }
}

// ---------- الكانبان: لكل مرحلة، أحدث N ليد + العدد الحقيقي ----------
export async function fetchStageColumn({ stageId, filters = {}, limit = 50, sort = 'recent' }) {
  // مع فلاتر التاسكات: العدّ والصفحة من v_lead_flags مباشرة
  if (hasTaskFilter(filters)) {
    const total = await flagCount({ stageIds: [stageId], filters })
    if (!total) return { rows: [], total: 0 }
    const ids = await flagLeadIds({ stageIds: [stageId], filters, from: 0, to: limit - 1, sort })
    if (!ids.length) return { rows: [], total }

    let dataQ = leadsFrom(filters, LEAD_COLUMNS).in('id', ids)
    dataQ = applyFilters(dataQ, filters)
    const { data } = await dataQ
    const order = Object.fromEntries(ids.map((id, i) => [id, i]))
    const rows = (data ?? []).sort((a, b) => order[a.id] - order[b.id])
    return { rows, total }
  }

  // استعلام واحد يرجّع صفحة العمود + العدد الحقيقي معًا (count: exact مع الصفحة)
  // بدل استعلامين لكل عمود.
  // sort: recent = الأحدث نشاطًا · oldest = الأقدم (المهملون أولًا)
  let q = leadsFrom(filters, LEAD_COLUMNS, { count: 'exact' })
    .eq('stage_id', stageId)
    .order('last_activity', { ascending: sort === 'oldest', nullsFirst: sort === 'oldest' })
    .limit(limit)
  q = applyFilters(q, filters)
  const { data, count } = await q

  return { rows: data ?? [], total: count ?? 0 }
}
