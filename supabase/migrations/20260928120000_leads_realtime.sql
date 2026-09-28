-- تفعيل Realtime على جدول leads (للبوردين وجدول الليدات)
-- الـ RLS بيتطبق على الأحداث: كل مستخدم بيوصله بس الصفوف المسموح له يشوفها.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
