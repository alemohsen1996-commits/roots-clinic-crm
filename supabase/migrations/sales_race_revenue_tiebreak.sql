-- سباق السيلز: كسر التعادل بالإيراد
--   الترتيب: عدد العمليات الجراحية اللي تمت في الشهر ↓
--            ثم إيراد نفس العمليات (net_amount = الإجمالي − الضريبة، زي تقرير أداء الفريق) ↓
--            ثم صاحب المركز الحالي (لو متساويين في العدد والإيراد بالظبط) ثم الأسبق
--   الإيراد بيُستخدم في الترتيب بس — مش بيرجع في sales_race() (السيلز مايشوفوش مبالغ بعض)
--   التريجر بقى يحدّث السباق كمان لو سعر/ضريبة عملية تمت اتعدّل

create or replace function public._race_rank(p_month date)
returns table(user_id uuid, full_name text, ops bigint, pos bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  with st as (select first_id, second_id from public.sales_race_state where month = p_month),
  c as (
    select p.id, p.full_name, count(*) as ops,
           coalesce(sum(d.net_amount), 0) as rev,
           max(d.outcome_at) as last_at, max(d.id) as last_id
    from public.deals d
    join public.profiles p on p.id = d.agent_id
    join public.roles r on r.id = p.role_id
    where r.code = 'agent' and p.status = 'active'
      and d.status = 'done'
      and public.deal_kind(d.procedure_type_id) = 'surgery'
      and date_trunc('month', d.outcome_at at time zone 'Asia/Riyadh')::date = p_month
    group by p.id, p.full_name
  )
  select c.id, c.full_name, c.ops,
         row_number() over (order by c.ops desc, c.rev desc,
           case when c.id = (select first_id from st) then 0
                when c.id = (select second_id from st) then 1 else 2 end,
           c.last_at, c.last_id)
  from c
$function$;

create or replace function public.race_on_deal_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'done' then return null; end if;
  elsif not ((old.status = 'done' or new.status = 'done')
             and (new.status is distinct from old.status
                  or new.outcome_at is distinct from old.outcome_at
                  or new.agent_id is distinct from old.agent_id
                  or new.procedure_type_id is distinct from old.procedure_type_id
                  or new.net_amount is distinct from old.net_amount)) then
    return null;
  end if;
  perform public._race_refresh();
  return null;
exception when others then
  raise warning 'race refresh failed: %', sqlerrm;
  return null;
end $function$;
