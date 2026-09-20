
-- تحسين أداء RLS: تغليف نداءات الدوال بـ (select …) لتُحسب مرة واحدة لكل استعلام
-- (InitPlan) بدل كل صف. لا يغيّر منطق أي سياسة — فقط شكل النداء.
-- يستخدم ALTER POLICY (fail-closed): أي فشل لا يحذف سياسة، والـ migration ذرّي.
do $$
declare
  r record;
  nu text;
  nc text;
begin
  for r in
    select pol.polname as name, cls.relname as tbl,
           pg_get_expr(pol.polqual, pol.polrelid)      as u,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as c
    from pg_policy pol
    join pg_class cls    on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
  loop
    nu := r.u;
    nc := r.c;

    if nu is not null then
      nu := replace(nu, 'auth.uid()',          '(select auth.uid())');
      nu := replace(nu, 'is_manager_safe()',   '(select is_manager_safe())');
      nu := replace(nu, 'is_active_user()',     '(select is_active_user())');
      nu := replace(nu, 'current_role_code()',  '(select current_role_code())');
      nu := replace(nu, 'is_manager()',         '(select is_manager())');
    end if;

    if nc is not null then
      nc := replace(nc, 'auth.uid()',          '(select auth.uid())');
      nc := replace(nc, 'is_manager_safe()',   '(select is_manager_safe())');
      nc := replace(nc, 'is_active_user()',     '(select is_active_user())');
      nc := replace(nc, 'current_role_code()',  '(select current_role_code())');
      nc := replace(nc, 'is_manager()',         '(select is_manager())');
    end if;

    if (nu is distinct from r.u) or (nc is distinct from r.c) then
      if nu is not null and nc is not null then
        execute format('alter policy %I on public.%I using (%s) with check (%s)', r.name, r.tbl, nu, nc);
      elsif nu is not null then
        execute format('alter policy %I on public.%I using (%s)', r.name, r.tbl, nu);
      elsif nc is not null then
        execute format('alter policy %I on public.%I with check (%s)', r.name, r.tbl, nc);
      end if;
    end if;
  end loop;
end $$;
