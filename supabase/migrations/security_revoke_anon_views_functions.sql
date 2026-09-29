-- أمان: الزائر غير المسجّل (مفتاح anon الموجود في كود الموقع) كان يقدر يقرا
-- أسماء وأرقام كل الليدات من v_lead_flags وأرقام الإيراد والعمولات من v_month_*
-- وكمان يشغّل دوال زي notify / reassign_untouched_leads
-- الـ CRM مش بيحتاج أي حاجة من دول قبل تسجيل الدخول، والسيرفر بيستخدم المفتاح السري

-- 1) الـ views (بتتخطى RLS) — مقفولة على الزائر
revoke all on public.v_lead_flags, public.v_month_totals, public.v_month_to_date,
              public.v_appointments, public.v_deal_finance
  from anon;

-- 2) كل الدوال في public — التنفيذ للمسجّلين فقط
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;

-- 3) أي دالة جديدة بعد كده تتقفل تلقائي على الزائر
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant  execute on functions to authenticated, service_role;
