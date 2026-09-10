// البيانات المرجعية لوحدة الديلات: أنواع العمليات، الأطباء، المنسقات
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useDealRefs() {
  const [procedures, setProcedures] = useState([])
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
    ]).then(([p, t, d, c]) => {
      setProcedures(p.data ?? [])
      setTechniques(t.data ?? [])
      setDoctors(d.data ?? [])
      setCoordinators(c.data ?? [])
      setReady(true)
    })
  }, [])

  return { procedures, techniques, doctors, coordinators, ready }
}

// استعلام الديلات مع المالية — RLS تضمن أن كل دور يرى ما يخصه
export async function fetchDeals(filters = {}) {
  let q = supabase
    .from('deals')
    .select(`
      id, lead_id, procedure_no, status, grafts, total_amount, tax_amount, net_amount,
      operation_date, is_locked, created_at,
      leads(file_no, full_name, phone),
      agent:profiles!deals_agent_id_fkey(full_name),
      coordinator:profiles!deals_coordinator_id_fkey(full_name),
      procedure_types(name_ar),
      techniques(name),
      doctors(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(300)

  if (filters.status) q = q.eq('status', filters.status)
  if (filters.coordinator) q = q.eq('coordinator_id', filters.coordinator)
  if (filters.search) {
    // البحث عبر بيانات الليد يتطلب فلترة محلية — نكتفي هنا بالحد الأعلى ثم نفلتر في الواجهة
  }

  const { data, error } = await q
  if (error) console.error(error)
  return data ?? []
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
