-- صفحة الديلات: View مسطّح فيه كل اللي الجدول محتاجه (العميل، الفرع، الفريق، التحصيل، التنبيهات)
-- security_invoker → الـ RLS بتاعة deals/leads/payments بتتطبق زي ما هي
create or replace view public.v_deals_list
with (security_invoker = true) as
select
  d.id, d.lead_id, d.procedure_no, d.status, d.grafts,
  d.total_amount, d.tax_amount, d.net_amount, d.operation_date,
  d.is_locked, d.created_at, d.agent_id, d.coordinator_id,
  l.full_name, l.phone, l.phone_norm, l.file_no, l.branch_id,
  b.name       as branch_name,
  ag.full_name as agent_name,
  co.full_name as coordinator_name,
  pt.name_ar   as procedure_name,
  t.name       as technique_name,
  coalesce(p.collected, 0)                       as collected,
  d.total_amount - coalesce(p.collected, 0)      as remaining,
  -- المتبقي الفعلي للمتابعة: صفر للخسارة/الملغي
  case when d.status in ('lost', 'cancelled') then 0
       else greatest(d.total_amount - coalesce(p.collected, 0), 0) end as open_remaining,
  -- تاريخ العملية عدّى والديل لسه مفتوح
  (d.status in ('active', 'waiting')
     and d.operation_date < (now() at time zone 'Asia/Riyadh')::date) as is_overdue
from public.deals d
left join public.leads l           on l.id = d.lead_id
left join public.branches b        on b.id = l.branch_id
left join public.profiles ag       on ag.id = d.agent_id
left join public.profiles co       on co.id = d.coordinator_id
left join public.procedure_types pt on pt.id = d.procedure_type_id
left join public.techniques t      on t.id = d.technique_id
left join lateral (
  select sum(pay.amount) as collected
  from public.payments pay
  where pay.deal_id = d.id and pay.status = 'active'
) p on true;

revoke all on public.v_deals_list from anon;
grant select on public.v_deals_list to authenticated;

-- أرقام الكروت والتبويبات على كل الديلات المطابقة للفلاتر (مش الصفحة المعروضة بس)
create or replace function public.deals_overview(
  p_from   date   default null,
  p_to     date   default null,
  p_branch bigint default null,
  p_agent  uuid   default null,
  p_coord  uuid   default null,
  p_search text   default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with term as (
    select nullif(trim(coalesce(p_search, '')), '') as t,
           nullif(regexp_replace(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '^0+', ''), '') as digits
  ),
  x as (
    select v.* from public.v_deals_list v, term
    where (p_from   is null or v.operation_date >= p_from)
      and (p_to     is null or v.operation_date <= p_to)
      and (p_branch is null or v.branch_id = p_branch)
      and (p_agent  is null or v.agent_id = p_agent)
      and (p_coord  is null or v.coordinator_id = p_coord)
      and (term.t is null
           or v.full_name ilike '%' || term.t || '%'
           or v.file_no   ilike '%' || term.t || '%'
           or (length(term.digits) >= 3 and v.phone_norm ilike '%' || term.digits || '%'))
  )
  select jsonb_build_object(
    'total',         (select count(*) from x),
    'by_status',     coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from x group by status) s), '{}'::jsonb),
    'done_count',    (select count(*) from x where status = 'done'),
    'done_net',      (select coalesce(sum(net_amount), 0) from x where status = 'done'),
    'waiting_count', (select count(*) from x where status = 'waiting'),
    'waiting_net',   (select coalesce(sum(net_amount), 0) from x where status = 'waiting'),
    'rem_sum',       (select coalesce(sum(open_remaining), 0) from x),
    'rem_count',     (select count(*) from x where open_remaining > 0),
    'overdue_count', (select count(*) from x where is_overdue)
  );
$$;

revoke all on function public.deals_overview(date, date, bigint, uuid, uuid, text) from public, anon;
grant execute on function public.deals_overview(date, date, bigint, uuid, uuid, text) to authenticated;
