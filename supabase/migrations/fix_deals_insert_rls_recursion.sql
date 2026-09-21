-- إصلاح: infinite recursion في سياسة deals
-- السبب: سياسة إدخال deals تعمل EXISTS(SELECT FROM leads) فتشغّل سياسة قراءة leads،
-- وسياسة قراءة leads تعمل EXISTS(SELECT FROM deals) فتشغّل سياسة deals → حلقة.
-- الحل: نقل فحص leads داخل سياسة deals إلى دوال security definer تتخطّى RLS.

create or replace function public.i_own_lead(p_lead_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id and l.owner_id = auth.uid()
  );
$$;

create or replace function public.i_coordinate_lead(p_lead_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id and l.coordinator_id = auth.uid()
  );
$$;

revoke all on function public.i_own_lead(bigint)        from public;
revoke all on function public.i_coordinate_lead(bigint) from public;
grant execute on function public.i_own_lead(bigint)        to authenticated;
grant execute on function public.i_coordinate_lead(bigint) to authenticated;

-- إعادة كتابة سياسة الإدخال بنفس المنطق لكن عبر الدوال (بلا subquery على leads)
alter policy "إنشاء ديل" on public.deals
with check (
  (select is_manager())
  or (coordinator_id = (select auth.uid()))
  or (agent_id = (select auth.uid()) and public.i_own_lead(lead_id))
  or public.i_coordinate_lead(lead_id)
);
