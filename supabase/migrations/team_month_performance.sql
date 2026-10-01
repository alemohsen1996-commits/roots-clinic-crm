-- أداء الفريق لأي شهر (نفس حساب v_month_to_date بالظبط لكن لشهر مختار)
-- المدير يشوف الكل، غيره يشوف نفسه بس. الموظف اللي اتوقف يظهر لو ليه أرقام في الشهر ده
create or replace function public.team_month_performance(p_month date default null)
returns table(
  user_id uuid, full_name text, role_code text,
  deals_count bigint, revenue numeric, collected numeric,
  monthly_target numeric, leads_received bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with m as (select date_trunc('month', coalesce(p_month, now()::date)::timestamptz) as m),
  people as (
    select p.id, p.full_name, r.code as role_code, p.monthly_target, p.status
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where public.is_manager_safe() or p.id = auth.uid()
  ),
  calc as (
    select pp.id as user_id, pp.full_name, pp.role_code, pp.status,
      (select count(distinct d.id) from public.deals d, m
        where (d.agent_id = pp.id or d.coordinator_id = pp.id)
          and d.status = 'done' and date_trunc('month', d.outcome_at) = m.m) as deals_count,
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
  select user_id, full_name, role_code, deals_count, revenue, collected, monthly_target, leads_received
  from calc
  where status = 'active'
     or deals_count > 0 or revenue > 0 or collected > 0 or leads_received > 0;
$$;

revoke all on function public.team_month_performance(date) from public, anon;
grant execute on function public.team_month_performance(date) to authenticated;
