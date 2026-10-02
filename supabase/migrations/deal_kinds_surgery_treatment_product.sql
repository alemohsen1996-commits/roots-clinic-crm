-- ===================== أنواع البيع: عملية / جلسات علاج / منتج =====================
-- (اتطبق على Supabase كـ 3 migrations: deal_kinds_surgery_treatment_product,
--  deal_kinds_reports_and_archive, prp_course_first_session_on_purchase)
-- "العمليات" في كل الأرقام = العمليات الجراحية بس. الإيراد يفضل الإجمالي (كل المبيعات).

alter table public.procedure_types
  add column if not exists kind text not null default 'surgery'
  check (kind in ('surgery', 'treatment', 'product'));

update public.procedure_types set kind = 'treatment' where code = 'prp';
insert into public.procedure_types (code, name_ar, base_price, is_active, kind)
select 'medical_kit', 'حقيبة طبية', 0, true, 'product'
where not exists (select 1 from public.procedure_types where code = 'medical_kit');

create or replace function public.deal_kind(p_type_id bigint)
returns text language sql stable set search_path to 'public' as $$
  select coalesce((select kind from public.procedure_types where id = p_type_id), 'surgery');
$$;

insert into public.stages (code, name_ar, color, sort_order, category, counts_in_conversion,
                           requires_note, requires_coordinator, is_active, board, is_core, no_alert)
select 'service_client', 'عميل خدمات (بدون عملية)', '#0ea5e9', 14, 'won', true,
       false, false, true, 'coordinator', true, false
where not exists (select 1 from public.stages where code = 'service_client');

-- رقم العملية = ترتيب العمليات الجراحية بس
create or replace function public.set_deal_procedure_no()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  select count(*) + 1 into new.procedure_no
  from public.deals
  where lead_id = new.lead_id and status = 'done'
    and public.deal_kind(procedure_type_id) = 'surgery';
  return new;
end $$;

-- باقة بلازما: للعمليات (تبدأ بعد شهر) وكورسات العلاج (أول جلسة يوم الشراء)، مش للمنتجات
create or replace function public.auto_create_prp()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_pkg_id bigint;
  v_sessions int := 3;
  v_kind text := public.deal_kind(new.procedure_type_id);
  i int;
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and v_kind <> 'product'
     and not exists (select 1 from public.prp_packages where deal_id = new.id)
  then
    insert into public.prp_packages (deal_id, lead_id, sessions_total)
    values (new.id, new.lead_id, v_sessions)
    returning id into v_pkg_id;
    for i in 1..v_sessions loop
      insert into public.prp_sessions (package_id, session_no, planned_date)
      values (v_pkg_id, i, coalesce(new.operation_date, current_date)
                           + ((case when v_kind = 'treatment' then i - 1 else i end) * 30));
    end loop;
  end if;
  return new;
end $$;

-- مرحلة الليد بعد "تمت": عملية → "تمت العملية"، جلسات/منتج من غير أي عملية سابقة → "عميل خدمات"
create or replace function public.sync_lead_stage_with_deal()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_code text; v_stage_id int; v_cur_stage int;
begin
  if new.status is not distinct from old.status then return null; end if;
  v_code := case new.status when 'done' then 'done' when 'lost' then 'lost'
                            when 'waiting' then 'waiting' else null end;
  if v_code is null then return null; end if;

  if v_code = 'done'
     and public.deal_kind(new.procedure_type_id) <> 'surgery'
     and not exists (select 1 from public.deals d
                     where d.lead_id = new.lead_id and d.id <> new.id and d.status = 'done'
                       and public.deal_kind(d.procedure_type_id) = 'surgery') then
    v_code := 'service_client';
  end if;

  select id into v_stage_id from public.stages where code = v_code limit 1;
  if v_stage_id is null then return null; end if;
  select stage_id into v_cur_stage from public.leads where id = new.lead_id;
  if v_cur_stage is not distinct from v_stage_id then return null; end if;

  update public.leads
  set stage_id = v_stage_id, stage_entered_at = now(), last_activity = now(), updated_at = now()
  where id = new.lead_id;
  return null;
end $$;

-- الحارس: "عميل خدمات" محمي زي "تمت العملية"، وآخر ديل بالأحدث إنشاءً
create or replace function public.guard_stage_requires_deal()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_code text; v_last_status text;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select code into v_code from public.stages where id = new.stage_id;
  if v_code not in ('waiting', 'done', 'won', 'service_client') then return new; end if;

  if exists (select 1 from public.deals d where d.lead_id = new.id
      and (d.status in ('active', 'waiting')
           or (d.status = 'done' and d.updated_at >= now() - interval '2 minutes'))) then
    return new;
  end if;

  if v_code in ('done', 'won', 'service_client') then
    select d.status into v_last_status from public.deals d
    where d.lead_id = new.id order by d.created_at desc limit 1;
    if v_last_status = 'done' then return new; end if;
  end if;

  raise exception 'لازم يتفتح ديل تعاقد للمريض الأول قبل ما ينتقل للمرحلة دي'
    using errcode = 'P0001', hint = 'deal_required';
end $$;

-- "حضر المعاينة" تلقائي يشمل عميل الخدمات
create or replace function public.appt_mark_attended_on_operation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_appt record; v_stage text;
begin
  select code into v_stage from stages where id = new.stage_id;
  if v_stage not in ('done', 'repeat_procedure', 'service_client') then return new; end if;
  select a.* into v_appt from appointments a
   where a.lead_id = new.id order by a.appt_date desc nulls last, a.id desc limit 1;
  if v_appt.id is null or v_appt.status <> 'no_show'
     or v_appt.appt_date > (now() at time zone 'Asia/Riyadh')::date then
    return new;
  end if;
  if exists (select 1 from deals d where d.lead_id = new.id
              and d.operation_date is not null and d.operation_date < v_appt.appt_date) then
    return new;
  end if;
  update appointments
     set status = 'attended', updated_at = now(),
         coordinator_note = concat_ws(' — ', nullif(coordinator_note, ''),
                                      'اتعدّلت لـ«حضر» تلقائي: اتسجّل لم يحضر وبعدها عمل العملية')
   where id = v_appt.id;
  return new;
end $$;

-- عدد العمليات = جراحية بس في: _clinic_monthly_series / user_monthly_series / team_month_performance
-- / v_month_to_date / v_month_totals / report_summary ('deals' + 'other_sales') / _close_month
-- (نفس التعريفات السابقة مع: count(*) filter (where public.deal_kind(procedure_type_id) = 'surgery'))
-- + v_deals_list بقى فيه procedure_kind
-- + sales_breakdown(p_month, p_user): عدد وإيراد كل نوع في الشهر
create or replace function public.sales_breakdown(p_month date default null, p_user uuid default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with u as (
    select case when public.is_manager_safe() or public.current_role_code() = 'accountant'
                then p_user else auth.uid() end as id
  ),
  m as (select date_trunc('month', coalesce(p_month, now()::date)::timestamptz) as m),
  x as (
    select public.deal_kind(d.procedure_type_id) as kind, count(*) as n, sum(d.net_amount) as rev
    from public.deals d, m, u
    where d.status = 'done' and date_trunc('month', d.outcome_at) = m.m
      and (u.id is null or d.agent_id = u.id or d.coordinator_id = u.id)
    group by 1
  )
  select coalesce(jsonb_object_agg(kind, jsonb_build_object('count', n, 'revenue', coalesce(rev, 0))), '{}'::jsonb)
  from x;
$$;
revoke all on function public.sales_breakdown(date, uuid) from public, anon;
grant execute on function public.sales_breakdown(date, uuid) to authenticated;

-- تصحيح الموجود: ليدات في "تمت العملية" وكل اللي اشتروه مش عمليات → "عميل خدمات"
update public.leads l
set stage_id = (select id from public.stages where code = 'service_client'),
    stage_entered_at = now(), updated_at = now()
where l.stage_id = (select id from public.stages where code = 'done')
  and exists (select 1 from public.deals d where d.lead_id = l.id and d.status = 'done')
  and not exists (select 1 from public.deals d where d.lead_id = l.id and d.status = 'done'
                  and public.deal_kind(d.procedure_type_id) = 'surgery');
