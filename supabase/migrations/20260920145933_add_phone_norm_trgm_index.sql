
-- فهرس trigram على الرقم المطبّع لتسريع البحث بالاحتواء (phone_norm ILIKE '%...%')
create index if not exists idx_leads_phone_norm_trgm
  on public.leads using gin (phone_norm gin_trgm_ops);
