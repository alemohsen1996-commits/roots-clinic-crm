-- 1) الموظف يشوف أرقامه بس، والمديرين يشوفوا الكل
alter view public.v_deal_finance set (security_invoker = true);
alter view public.v_lead_flags   set (security_invoker = true);

-- v_month_to_date / v_month_totals: نفس التعريف السابق + شرط الصلاحية
--   v_month_to_date: ... WHERE p.status = 'active' AND (is_manager_safe() OR p.id = auth.uid())
--   v_month_totals : ... WHERE is_manager_safe()
-- user_monthly_series / compare_months: غير المدير/المحاسب يشوف نفسه بس
-- (النص الكامل متطبق على Supabase عبر migration: security_views_scope_and_manager_commission)

-- 2) مدير المبيعات بياخد عمولة على ديلاته بشرائح السيلز
--   _calc_commission: v_role in ('agent','sales_manager') and d.agent_id = p_user
--   _close_month: الأرشيف يشمل sales_manager + التحصيل من الدفعات الفعّالة بس

revoke execute on function public._calc_commission(uuid, date), public._close_month(date) from public, anon, authenticated;
