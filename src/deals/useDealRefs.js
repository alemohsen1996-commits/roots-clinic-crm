// البيانات المرجعية لوحدة الديلات: أنواع العمليات، الأطباء، المنسقات
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SALES_ROLES, sortSales } from '../lib/people'

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
        .in('roles.code', SALES_ROLES),
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

// استعلام الديلات مع المالية — RLS تضمن أن كل دور يرى ما يخصه
// صفحة واحدة + العدد الكلي، والبحث في القاعدة (مش على أول 300 بس)
export async function fetchDeals({ status, agent, coordinator, search, page = 0, pageSize = 50 } = {}) {
  const term = (search ?? '').trim().replace(/[,()%*\\]/g, ' ').trim()
  // مع البحث: inner join على الليد عشان الفلترة على بياناته تشيل الديلات اللي مش مطابقة
  const leadRel = term ? 'leads!inner' : 'leads'

  let q = supabase
    .from('deals')
    .select(`
      id, lead_id, procedure_no, status, grafts, total_amount, tax_amount, net_amount,
      operation_date, is_locked, created_at,
      ${leadRel}(file_no, full_name, phone),
      agent:profiles!deals_agent_id_fkey(full_name),
      coordinator:profiles!deals_coordinator_id_fkey(full_name),
      procedure_types(name_ar),
      techniques(name),
      doctors(full_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)

  if (status) q = q.eq('status', status)
  if (coordinator) q = q.eq('coordinator_id', coordinator)
  if (agent) q = q.eq('agent_id', agent)
  if (term) {
    const conds = [`full_name.ilike.%${term}%`, `file_no.ilike.%${term}%`]
    // الهاتف: أرقام بس، ومن غير الصفر الأول (0507… تلاقي 966507…)
    const digits = term.replace(/\D/g, '').replace(/^0+/, '')
    if (digits.length >= 3) conds.push(`phone_norm.ilike.%${digits}%`)
    q = q.or(conds.join(','), { referencedTable: 'leads' })
  }

  const { data, count, error } = await q
  if (error) console.error(error)
  return { rows: data ?? [], total: count ?? 0 }
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

export const DEAL_STATUS = {
  active:    { label: 'نشط',        cls: 'badge-active' },
  done:      { label: 'تمت العملية', cls: 'badge-active' },
  lost:      { label: 'خسارة',       cls: 'badge-suspended' },
  waiting:   { label: 'انتظار',      cls: 'badge-pending' },
  cancelled: { label: 'ملغي',        cls: 'badge-suspended' },
}

export const PAY_STATUS = {
  paid:    { label: 'مدفوع بالكامل', cls: 'badge-active' },
  partial: { label: 'جزئي',          cls: 'badge-pending' },
  unpaid:  { label: 'غير مدفوع',     cls: 'badge-suspended' },
}
