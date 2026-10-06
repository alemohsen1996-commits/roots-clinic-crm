-- إلغاء مباشر للدفعة من المحاسب/المدير (بدون موافقة) — سبب الإلغاء إجباري
-- قرار أكتوبر 2026: المحاسب يلغي بنفسه من تفاصيل المحصّل على الديل.
--
-- active → void في update واحد (مش request ثم approve): كده trigger الإشعارات
-- (notify_payment_void) مبيبعتش "طلب إلغاء" لكل المديرين وبعدين يقفله، ولا
-- يبعت للمحاسب إشعار "تمت الموافقة" على حاجة عملها بنفسه.
-- void_requested_by و void_approved_by الاتنين باسم اللي ألغى.
-- لو الدفعة عليها طلب معلّق من حد تاني: نعتمده عادي (approve_payment_void)
-- عشان صاحب الطلب يوصله إشعار الموافقة ويفضل سببه.

create or replace function public.void_payment_direct(p_payment_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'غير مسجل الدخول';
  end if;

  select r.code into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();

  if coalesce(v_role, '') not in ('super_admin', 'sales_manager', 'accountant') then
    raise exception 'الإلغاء المباشر يتطلب صلاحية مدير أو محاسب';
  end if;

  if v_reason is null then
    raise exception 'سبب الإلغاء مطلوب';
  end if;

  -- قفل الصف عشان محدش يلغي/يؤكد نفس الدفعة في نفس اللحظة
  select status into v_status from public.payments where id = p_payment_id for update;

  if v_status is null or v_status = 'void' then
    raise exception 'الدفعة غير موجودة أو سبق إلغاؤها';
  end if;

  if v_status = 'void_requested' then
    perform public.approve_payment_void(p_payment_id);
    return;
  end if;

  update public.payments
  set status            = 'void',
      void_reason       = v_reason,
      void_requested_by = auth.uid(),
      void_requested_at = now(),
      void_approved_by  = auth.uid(),
      void_approved_at  = now()
  where id = p_payment_id and status = 'active';
end;
$$;

revoke all on function public.void_payment_direct(bigint, text) from public, anon;
grant execute on function public.void_payment_direct(bigint, text) to authenticated;

-- إصلاحات في الدوال القديمة:
-- 1) فحص الصلاحية: لو المستخدم مالوش profile/role كان v_role = null و
--    (null not in (...)) = null → الشرط مبيتحققش والدالة بتكمّل. اتصلح بـ coalesce.
-- 2) reject_payment_void كانت بتنجح بصمت لو مفيش طلب معلّق — دلوقتي بترمي خطأ زي approve.

create or replace function public.approve_payment_void(p_payment_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select r.code into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();

  if coalesce(v_role, '') not in ('super_admin', 'sales_manager', 'accountant') then
    raise exception 'الموافقة على الإلغاء تتطلب صلاحية مدير أو محاسب';
  end if;

  update public.payments
  set status = 'void',
      void_approved_by = auth.uid(),
      void_approved_at = now()
  where id = p_payment_id and status = 'void_requested';

  if not found then
    raise exception 'لا يوجد طلب إلغاء معلّق لهذه الدفعة';
  end if;
end;
$$;

create or replace function public.reject_payment_void(p_payment_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select r.code into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();

  if coalesce(v_role, '') not in ('super_admin', 'sales_manager', 'accountant') then
    raise exception 'رفض الإلغاء يتطلب صلاحية مدير أو محاسب';
  end if;

  update public.payments
  set status = 'active',
      void_reason = null,
      void_requested_by = null,
      void_requested_at = null
  where id = p_payment_id and status = 'void_requested';

  if not found then
    raise exception 'لا يوجد طلب إلغاء معلّق لهذه الدفعة';
  end if;
end;
$$;
