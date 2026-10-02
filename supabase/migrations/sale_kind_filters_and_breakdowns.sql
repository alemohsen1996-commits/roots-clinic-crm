-- فلاتر وتقسيمات أنواع البيع: صفحة الديلات + أداء الفريق + التقارير

-- 1) أرقام صفحة الديلات: فلتر نوع + عدد كل نوع (للشريط) + المتممة لكل نوع (لسطر الكارت)
drop function if exists public.deals_overview(date, date, bigint, uuid, uuid, text);
create or replace function public.deals_overview(
  p_from date default null, p_to date default null, p_branch bigint default null,
  p_agent uuid default null, p_coord uuid default null, p_search text default null,
  p_kind text default null
)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with term as (
    select nullif(trim(coalesce(p_search, '')), '') as t,
           nullif(regexp_replace(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '^0+', ''), '') as digits
  ),
  base as (
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
  ),
  x as (select * from base where p_kind is null or procedure_kind = p_kind)
  select jsonb_build_object(
    'total',         (select count(*) from x),
    'by_status',     coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from x group by status) s), '{}'::jsonb),
    'by_kind',       coalesce((select jsonb_object_agg(procedure_kind, n) from (select procedure_kind, count(*) n from base group by procedure_kind) s), '{}'::jsonb),
    'done_by_kind',  coalesce((select jsonb_object_agg(procedure_kind, n) from (select procedure_kind, count(*) n from x where status = 'done' group by procedure_kind) s), '{}'::jsonb),
    'done_count',    (select count(*) from x where status = 'done'),
    'done_net',      (select coalesce(sum(net_amount), 0) from x where status = 'done'),
    'waiting_count', (select count(*) from x where status = 'waiting'),
    'waiting_net',   (select coalesce(sum(net_amount), 0) from x where status = 'waiting'),
    'rem_sum',       (select coalesce(sum(open_remaining), 0) from x),
    'rem_count',     (select count(*) from x where open_remaining > 0),
    'overdue_count', (select count(*) from x where is_overdue)
  );
$$;
revoke all on function public.deals_overview(date, date, bigint, uuid, uuid, text, text) from public, anon;
grant execute on function public.deals_overview(date, date, bigint, uuid, uuid, text, text) to authenticated;

-- 2) أداء الفريق: عمود جلسات/منتجات
drop function if exists public.team_month_performance(date);
create or replace function public.team_month_performance(p_month date default null)
returns table(user_id uuid, full_name text, role_code text, deals_count bigint, other_count bigint,
              revenue numeric, collected numeric, monthly_target numeric, leads_received bigint)
language sql stable security definer set search_path to 'public' as $$
  with m as (select date_trunc('month', coalesce(p_month, now()::date)::timestamptz) as m),
  people as (
    select p.id, p.full_name, r.code as role_code, p.monthly_target, p.status
    from public.profiles p join public.roles r on r.id = p.role_id
    where public.is_manager_safe() or p.id = auth.uid()
  ),
  calc as (
    select pp.id as user_id, pp.full_name, pp.role_code, pp.status,
      (select count(distinct d.id) from public.deals d, m
        where (d.agent_id = pp.id or d.coordinator_id = pp.id)
          and d.status = 'done' and date_trunc('month', d.outcome_at) = m.m
          and public.deal_kind(d.procedure_type_id) = 'surgery') as deals_count,
      (select count(distinct d.id) from public.deals d, m
        where (d.agent_id = pp.id or d.coordinator_id = pp.id)
          and d.status = 'done' and date_trunc('month', d.outcome_at) = m.m
          and public.deal_kind(d.procedure_type_id) <> 'surgery') as other_count,
      coalesce((select sum(d.net_amount) from public.deals d, m
        where (d.agent_id = pp.id or d.coordinator_id = pp.id)
          and d.status = 'done' and date_trunc('month', d.outcome_at) = m.m), 0) as revenue,
      coalesce((select sum(pay.amount) from public.payments pay
        join public.deals dd on dd.id = pay.deal_id, m
        where (dd.agent_id = pp.id or dd.coordinator_id = pp.id)
          and pay.status = 'active' and date_trunc('month', pay.paid_at) = m.m), 0) as collected,
      pp.monthly_target,
      (select count(distinct l.id) from public.leads l, m
        where l.owner_id = pp.id and date_trunc('month', l.created_at) = m.m) as leads_received
    from people pp
  )
  select user_id, full_name, role_code, deals_count, other_count, revenue, collected, monthly_target, leads_received
  from calc
  where status = 'active'
     or deals_count > 0 or other_count > 0 or revenue > 0 or collected > 0 or leads_received > 0;
$$;
revoke all on function public.team_month_performance(date) from public, anon;
grant execute on function public.team_month_performance(date) to authenticated;

-- 3) التقارير: فلتر نوع + تقسيم الإيراد حسب النوع
drop function if exists public.report_summary(timestamptz, timestamptz);
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_kind text default null)
returns jsonb language sql stable set search_path to 'public' as $$
with
l as (
  select id, stage_id, source_id, lost_reason_id, owner_id, coordinator_id
    from leads where created_at between p_from and p_to
),
dall as (
  select id, lead_id, net_amount, agent_id, coordinator_id,
         public.deal_kind(procedure_type_id) as kind
    from deals where status = 'done' and outcome_at between p_from and p_to
),
d as (
  select *, (case when p_kind is null then kind = 'surgery' else true end) as counts
  from dall where p_kind is null or kind = p_kind
),
reached as (
  select to_stage as stage_id, lead_id from activities
   where type = 'stage_change' and to_stage is not null and created_at between p_from and p_to
  union
  select stage_id, id from l
),
person as (
  select owner_id as pid, count(*) as leads, 0::bigint as deals, 0::bigint as other, 0::numeric as revenue
    from l where owner_id is not null group by owner_id
  union all
  select coordinator_id, count(*), 0, 0, 0
    from l where coordinator_id is not null and coordinator_id is distinct from owner_id
   group by coordinator_id
  union all
  select agent_id, 0, count(*) filter (where counts), count(*) filter (where not counts), coalesce(sum(net_amount), 0)
    from d where agent_id is not null group by agent_id
  union all
  select coordinator_id, 0, count(*) filter (where counts), count(*) filter (where not counts), coalesce(sum(net_amount), 0)
    from d where coordinator_id is not null and coordinator_id is distinct from agent_id
   group by coordinator_id
),
team as (
  select pid, sum(leads) as leads, sum(deals) as deals, sum(other) as other, sum(revenue) as revenue
    from person group by pid
)
select jsonb_build_object(
  'kind',        p_kind,
  'leads',       (select count(*) from l),
  'deals',       (select count(*) from d where counts),
  'other_sales', (select count(*) from d where not counts),
  'revenue',     (select coalesce(sum(net_amount), 0) from d),
  'by_kind',     coalesce((select jsonb_object_agg(kind, jsonb_build_object('count', n, 'revenue', rev))
                    from (select kind, count(*) n, coalesce(sum(net_amount), 0) rev from dall group by kind) k), '{}'::jsonb),
  'collected',   (select coalesce(sum(amount), 0) from payments
                   where status = 'active' and paid_at between p_from and p_to),
  'cohort_deals', (select count(distinct dd.lead_id)
                     from deals dd join l on l.id = dd.lead_id
                    where dd.status = 'done' and public.deal_kind(dd.procedure_type_id) = 'surgery'),
  'stage_counts', coalesce((
      select jsonb_object_agg(stage_id, n)
        from (select stage_id, count(*) as n from l where stage_id is not null group by stage_id) x
    ), '{}'::jsonb),
  'reached_counts', coalesce((
      select jsonb_object_agg(stage_id, n)
        from (select stage_id, count(distinct lead_id) as n from reached
               where stage_id is not null group by stage_id) x
    ), '{}'::jsonb),
  'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(s.name_ar, 'غير محدد'), 'count', x.n)
                       order by x.n desc)
        from (select source_id, count(*) as n from l group by source_id) x
        left join lead_sources s on s.id = x.source_id
    ), '[]'::jsonb),
  'by_lost', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(r.name_ar, 'أخرى'), 'count', x.n)
                       order by x.n desc)
        from (select lost_reason_id, count(*) as n from l
               where lost_reason_id is not null group by lost_reason_id) x
        left join lost_reasons r on r.id = x.lost_reason_id
    ), '[]'::jsonb),
  'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.pid, 'name', coalesce(p.full_name, '—'), 'role', ro.code,
               'status', p.status, 'leads', t.leads, 'deals', t.deals, 'other', t.other,
               'revenue', t.revenue)
             order by t.revenue desc, t.deals desc, t.leads desc)
        from team t
        left join profiles p on p.id = t.pid
        left join roles ro on ro.id = p.role_id
    ), '[]'::jsonb)
);
$$;
revoke all on function public.report_summary(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.report_summary(timestamptz, timestamptz, text) to authenticated;
