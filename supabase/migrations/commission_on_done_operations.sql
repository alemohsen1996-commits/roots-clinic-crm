-- قاعدة العمولة: الموظف (سيلز أو منسقة) يتحسب له الإيراد فقط لما العملية تتم فعلًا
-- الأساس = صافي الديلات اللي حالتها تمت وتاريخ النتيجة داخل الشهر
-- الفلوس المدفوعة قبل العملية مش بتدخل في العمولة لحد ما العملية تتم (ممكن المريض يلغي)
create or replace function public._calc_commission(p_user uuid, p_month date)
returns numeric
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_base numeric;
  v_commission numeric := 0;
  v_role text;
  t record;
  v_slice numeric;
begin
  select r.code into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = p_user;

  select coalesce(sum(d.net_amount), 0) into v_base
  from public.deals d
  where d.status = 'done'
    and date_trunc('month', d.outcome_at) = date_trunc('month', p_month)
    and (
      (v_role = 'agent' and d.agent_id = p_user)
      or (v_role = 'coordinator' and d.coordinator_id = p_user)
    );

  -- تطبيق الشرائح
  for t in
    select * from public.commission_tiers
    where role_code = case when v_role = 'coordinator' then 'coordinator' else 'agent' end
    order by min_amount
  loop
    exit when v_base <= t.min_amount;
    v_slice := least(v_base, coalesce(t.max_amount, v_base)) - t.min_amount;
    v_commission := v_commission + (v_slice * t.pct / 100);
  end loop;

  return round(v_commission, 2);
end; $$;
