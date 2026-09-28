-- رقم العملية يتحسب في الداتابيز: عدد العمليات اللي تمت فعلًا للعميل + 1
-- (الديلات الخاسرة أو الملغاة مش بتتحسب عملية)
create or replace function public.set_deal_procedure_no()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select count(*) + 1 into new.procedure_no
  from public.deals
  where lead_id = new.lead_id
    and status = 'done';
  return new;
end $$;

drop trigger if exists trg_deal_procedure_no on public.deals;
create trigger trg_deal_procedure_no
  before insert on public.deals
  for each row execute function public.set_deal_procedure_no();
