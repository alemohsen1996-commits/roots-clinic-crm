-- ثيم الواجهة لكل موظف (null = الافتراضي: كحلي ودهبي)
alter table public.profiles
  add column if not exists theme text
  check (theme is null or theme in ('teal', 'pink', 'dark'));

-- تحديث الثيم بتاع المستخدم نفسه بس — من غير ما نفتح UPDATE على profiles
create or replace function public.set_my_theme(p_theme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'غير مسجل الدخول';
  end if;
  update public.profiles
     set theme = nullif(p_theme, 'default')
   where id = auth.uid();
end $$;

revoke all on function public.set_my_theme(text) from public, anon;
grant execute on function public.set_my_theme(text) to authenticated;
