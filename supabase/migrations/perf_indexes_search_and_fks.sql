-- البحث في البورد: (الاسم أو الهاتف أو رقم الملف) — رقم الملف كان من غير فهرس trigram
-- فكان الـ OR بيجبر قراءة الجدول كله مع كل بحث في كل عمود
create index if not exists idx_leads_file_no_trgm on public.leads using gin (file_no gin_trgm_ops);

-- مفاتيح بيستخدمها RLS والتقارير ومكانتش مفهرسة
create index if not exists idx_deals_lead on public.deals (lead_id);
create index if not exists idx_prp_packages_deal on public.prp_packages (deal_id);
create index if not exists idx_prp_packages_lead on public.prp_packages (lead_id);

analyze public.leads, public.deals, public.tasks, public.prp_packages;
