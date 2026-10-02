-- العرض المقدّم كنطاق سعر: offered_price = "من" (أو السعر الواحد)، offered_price_max = "إلى" (اختياري)
alter table public.leads add column if not exists offered_price_max numeric;
alter table public.leads drop constraint if exists leads_offered_price_range_check;
alter table public.leads add constraint leads_offered_price_range_check
  check (offered_price_max is null or (offered_price is not null and offered_price_max >= offered_price));
