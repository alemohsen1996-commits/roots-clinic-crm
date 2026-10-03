-- (مطبّقة على المشروع) اللغة المفضلة للموظف + أسماء إنجليزية للجداول المرجعية
alter table public.profiles
  add column if not exists lang text not null default 'ar'
  check (lang in ('ar','en'));

create or replace function public.set_my_lang(p_lang text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_lang not in ('ar','en') then raise exception 'invalid lang'; end if;
  update public.profiles set lang = p_lang where id = auth.uid();
end $$;
grant execute on function public.set_my_lang(text) to authenticated;

-- الواجهة تعرض name_en لو اللغة إنجليزي ومتوفر، وإلا name_ar (dbName في src/lib/lang.js)
alter table public.roles           add column if not exists name_en text;
alter table public.stages          add column if not exists name_en text;
alter table public.lead_sources    add column if not exists name_en text;
alter table public.lost_reasons    add column if not exists name_en text;
alter table public.procedure_types add column if not exists name_en text;
alter table public.branches        add column if not exists name_en text;
-- + تعبئة الأسماء الإنجليزية للصفوف الموجودة (roles, stages, lead_sources, lost_reasons, procedure_types, branches)

-- (مطبّقة) v_deals_list: أعمدة branch_name_en و procedure_name_en مضافة في آخر الـ view

-- (مطبّقة) report_summary: by_source / by_lost فيهم label_en بجانب label

-- الإعدادات: خانة «الاسم بالإنجليزي» بتكتب في name_en للمراحل وأنواع البيع والمصادر والفروع (نفس الأعمدة فوق)
