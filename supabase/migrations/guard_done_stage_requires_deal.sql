-- مفيش ليد يروح "انتظار" أو "تمت العملية" من غير ديل تعاقد
-- مسموح لو: فيه ديل نشط/انتظار (هيتقفل مع النقل)، أو ديل لسه متعلّم "تمت" حالًا
-- (الحالة دي لما التعليم بيحصل من صفحة الديل والليد بيتنقل تلقائي)
create or replace function public.guard_stage_requires_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select code into v_code from public.stages where id = new.stage_id;
  if v_code not in ('waiting', 'done', 'won') then
    return new;
  end if;

  if exists (
    select 1 from public.deals d
    where d.lead_id = new.id
      and (d.status in ('active', 'waiting')
           or (d.status = 'done' and d.outcome_at >= now() - interval '2 minutes'))
  ) then
    return new;
  end if;

  raise exception 'لازم يتفتح ديل تعاقد للمريض الأول قبل ما ينتقل للمرحلة دي'
    using errcode = 'P0001', hint = 'deal_required';
end $$;

drop trigger if exists trg_guard_stage_requires_deal on public.leads;
create trigger trg_guard_stage_requires_deal
  before update of stage_id on public.leads
  for each row execute function public.guard_stage_requires_deal();

revoke execute on function public.guard_stage_requires_deal() from public, anon, authenticated;
