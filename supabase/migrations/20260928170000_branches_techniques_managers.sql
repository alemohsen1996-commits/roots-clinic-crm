-- الفروع وساعات عملها والتقنيات: التعديل للمديرين (المدير العام + مدير المبيعات)
-- (بترجع في قرار 20260928160000 اللي كان قافلهم على المدير العام بس)
drop policy if exists "إدارة الفروع: المدير العام" on public.branches;
create policy "إدارة الفروع: المديرين" on public.branches
  for all to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

drop policy if exists "تعديل إعدادات الفروع: المدير العام" on public.branch_schedules;
create policy "تعديل إعدادات الفروع: المديرين" on public.branch_schedules
  for all to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

drop policy if exists "إدارة التقنيات: المدير العام" on public.techniques;
create policy "إدارة التقنيات: المديرين" on public.techniques
  for all to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));
