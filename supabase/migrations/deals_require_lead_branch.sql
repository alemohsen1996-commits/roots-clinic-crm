-- الفرع إجباري: مفيش ديل يتفتح لعميل ملوش فرع في ملفه
create or replace function public.require_lead_branch()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select branch_id from public.leads where id = new.lead_id) is null then
    raise exception 'حدد فرع العميل قبل فتح ملف التعاقد' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_deal_require_branch on public.deals;
create trigger trg_deal_require_branch
  before insert on public.deals
  for each row execute function public.require_lead_branch();

revoke execute on function public.require_lead_branch() from public, anon, authenticated;
