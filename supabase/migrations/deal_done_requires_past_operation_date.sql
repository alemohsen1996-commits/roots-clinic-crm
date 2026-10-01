-- "تمت العملية" مسموحة بس لو تاريخ العملية النهارده أو قبل كده (بتوقيت الرياض)
-- التاريخ المستقبلي مسموح للديل النشط/الانتظار/الخسارة عادي
create or replace function public.on_deal_outcome()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'done'
     and (new.status is distinct from old.status
          or new.operation_date is distinct from old.operation_date)
     and new.operation_date > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'لا يمكن إتمام العملية بتاريخ في المستقبل — عدّل تاريخ العملية لليوم أو قبله'
      using errcode = 'P0001', hint = 'done_future_date';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'done' then
      new.outcome_at := public.deal_done_ts(new.operation_date);
    elsif new.status in ('lost', 'waiting') then
      new.outcome_at := now();
    end if;
  elsif new.status = 'done'
        and new.operation_date is distinct from old.operation_date then
    new.outcome_at := public.deal_done_ts(new.operation_date);
  end if;
  return new;
end $$;
