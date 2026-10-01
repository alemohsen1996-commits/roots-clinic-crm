-- شهر الإيراد/العمولة = شهر تاريخ العملية الفعلي، مش يوم ما المنسقة ضغطت "تمت العملية"
-- outcome_at هو المرجع في كل التقارير/العمولات/الأرشيف، فبنضبطه هو من تاريخ العملية

create or replace function public.deal_done_ts(p_op_date date)
returns timestamptz
language sql stable
set search_path to 'public'
as $$
  -- منتصف نهار الرياض لليوم ده (بعيد عن حدود الشهر في UTC)
  -- من غير تاريخ، أو تاريخ في المستقبل → اللحظة الحالية
  select case
    when p_op_date is null
      or p_op_date > (now() at time zone 'Asia/Riyadh')::date
    then now()
    else (p_op_date::timestamp + time '12:00') at time zone 'Asia/Riyadh'
  end;
$$;

create or replace function public.on_deal_outcome()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' then
      new.outcome_at := public.deal_done_ts(new.operation_date);
    elsif new.status in ('lost', 'waiting') then
      new.outcome_at := now();
    end if;
  -- ديل تم بالفعل واتعدّل تاريخ عمليته → الإيراد يتنقل لشهر التاريخ الجديد
  elsif new.status = 'done'
        and new.operation_date is distinct from old.operation_date then
    new.outcome_at := public.deal_done_ts(new.operation_date);
  end if;
  return new;
end $$;

drop trigger if exists trg_deal_outcome on public.deals;
create trigger trg_deal_outcome
  before update of status, operation_date on public.deals
  for each row execute function public.on_deal_outcome();

-- الحارس كان بيعتمد على outcome_at "آخر دقيقتين" — بقى ممكن يكون بتاريخ قديم،
-- فنعتمد على updated_at (بيتحدث في كل تعديل عن طريق protect_locked_deal)
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
           or (d.status = 'done' and d.updated_at >= now() - interval '2 minutes'))
  ) then
    return new;
  end if;

  raise exception 'لازم يتفتح ديل تعاقد للمريض الأول قبل ما ينتقل للمرحلة دي'
    using errcode = 'P0001', hint = 'deal_required';
end $$;
