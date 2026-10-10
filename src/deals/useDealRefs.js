// البيانات المرجعية لوحدة الديلات: أنواع العمليات، الأطباء، المنسقات
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import i18n from '../i18n'
import { OWNER_ROLES, sortSales } from '../lib/people'

export function useDealRefs() {
  const [procedures, setProcedures] = useState([])
  const [agents, setAgents] = useState([])
  const [techniques, setTechniques] = useState([])
  const [doctors, setDoctors] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('procedure_types').select('*').eq('is_active', true),
      supabase.from('techniques').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('doctors').select('*').eq('is_active', true),
      supabase.from('profiles')
        .select('id, full_name, roles!inner(code)')
        .eq('status', 'active')
        .eq('roles.code', 'coordinator'),
      supabase.from('profiles')
        .select('id, full_name, roles!inner(code)')
        .eq('status', 'active')
        .in('roles.code', OWNER_ROLES),
    ]).then(([p, t, d, c, ag]) => {
      setProcedures(p.data ?? [])
      setTechniques(t.data ?? [])
      setDoctors(d.data ?? [])
      setCoordinators(c.data ?? [])
      setAgents(sortSales(ag.data ?? []))
      setReady(true)
    })
  }, [])

  return { procedures, techniques, doctors, coordinators, agents, ready }
}

// تحويل نص البحث لشروط or على الـ View (الاسم/رقم الملف/الهاتف من غير الصفر الأول)
function searchConds(search) {
  const term = (search ?? '').trim().replace(/[,()%*\\]/g, ' ').trim()
  if (!term) return null
  const conds = [`full_name.ilike.%${term}%`, `file_no.ilike.%${term}%`]
  const digits = term.replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length >= 3) conds.push(`phone_norm.ilike.%${digits}%`)
  return conds.join(',')
}

// فلاتر مشتركة بين القائمة والتصدير
function applyDealFilters(q, { status, quick, from, to, branch, agent, coordinator, search, kind }) {
  if (status) q = q.eq('status', status)
  if (kind) q = q.eq('procedure_kind', kind)
  if (quick === 'overdue') q = q.eq('is_overdue', true)
  if (quick === 'remaining') q = q.gt('open_remaining', 0)
  if (from) q = q.gte('operation_date', from)
  if (to) q = q.lte('operation_date', to)
  if (branch) q = q.eq('branch_id', branch)
  if (agent) q = q.eq('agent_id', agent)
  if (coordinator) q = q.eq('coordinator_id', coordinator)
  const or = searchConds(search)
  if (or) q = q.or(or)
  return q
}

// label = مفتاح ترجمة (deals.sorts.*)
export const DEAL_SORTS = {
  date:      { col: 'operation_date', label: 'deals.sorts.date' },
  net:       { col: 'net_amount',     label: 'deals.sorts.net' },
  remaining: { col: 'open_remaining', label: 'deals.sorts.remaining' },
}

// قائمة الديلات من v_deals_list — RLS تضمن أن كل دور يرى ما يخصه
// صفحة واحدة + العدد الكلي، والفلترة والترتيب في القاعدة على كل الديلات
export async function fetchDeals({ sort = 'date', dir = 'desc', page = 0, pageSize = 50, ...filters } = {}) {
  const col = DEAL_SORTS[sort]?.col ?? 'operation_date'
  let q = supabase.from('v_deals_list').select('*', { count: 'exact' })
  q = applyDealFilters(q, filters)
    .order(col, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) console.error(error)
  return { rows: data ?? [], total: count ?? 0 }
}

// كل الصفوف المطابقة (للتصدير) — على دفعات 1000
export async function fetchAllDeals({ sort = 'date', dir = 'desc', ...filters } = {}) {
  const col = DEAL_SORTS[sort]?.col ?? 'operation_date'
  const out = []
  for (let off = 0; off < 20000; off += 1000) {
    const q = applyDealFilters(supabase.from('v_deals_list').select('*'), filters)
      .order(col, { ascending: dir === 'asc', nullsFirst: false })
      .order('id', { ascending: false })
      .range(off, off + 999)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// أرقام الكروت والتبويبات (كل الفلاتر ما عدا الحالة والفلتر السريع)
export async function fetchDealsOverview({ from, to, branch, agent, coordinator, search, kind } = {}) {
  const { data, error } = await supabase.rpc('deals_overview', {
    p_from: from || null, p_to: to || null,
    p_branch: branch ? Number(branch) : null,
    p_agent: agent || null, p_coord: coordinator || null,
    p_search: (search ?? '').trim() || null,
    p_kind: kind || null,
  })
  if (error) console.error(error)
  return data ?? null
}

// ملخص مالي لديل واحد من الـ View الجاهز
export async function fetchDealFinance(dealId) {
  const { data } = await supabase
    .from('v_deal_finance')
    .select('*')
    .eq('deal_id', dealId)
    .single()
  return data
}

// label = مفتاح ترجمة (dealStatus.* / payStatus.*) — اعرضه بـ t(x.label)
export const DEAL_STATUS = {
  active:    { label: 'dealStatus.active',    cls: 'badge-active' },
  done:      { label: 'dealStatus.done',      cls: 'badge-active' },
  lost:      { label: 'dealStatus.lost',      cls: 'badge-suspended' },
  waiting:   { label: 'dealStatus.waiting',   cls: 'badge-pending' },
  cancelled: { label: 'dealStatus.cancelled', cls: 'badge-suspended' },
}

export const PAY_STATUS = {
  paid:    { label: 'payStatus.paid',    cls: 'badge-active' },
  partial: { label: 'payStatus.partial', cls: 'badge-pending' },
  unpaid:  { label: 'payStatus.unpaid',  cls: 'badge-suspended' },
}

// أنواع البيع: عملية / جلسات علاج / منتج — بلغة الواجهة الحالية
export const KINDS = ['surgery', 'treatment', 'product']
export const kindLabel = (k) => i18n.t(`kind.${k}`, { defaultValue: k })
export const kindOf = (procedures, typeId) =>
  (procedures ?? []).find(p => String(p.id) === String(typeId))?.kind ?? 'surgery'
// اسم خانة التاريخ حسب النوع
export const dateLabel = (kind) =>
  i18n.t(kind === 'product' ? 'deals.dateDelivery' : kind === 'treatment' ? 'deals.dateFirstSession' : 'deals.dateOperation')

