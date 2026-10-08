-- البحث الشامل (Global Search) — خانة بحث ثابتة فوق في كل الصفحات + Ctrl+K
-- بيرجّع المريض وهو فين: البورد/المرحلة/المسؤول + آخر ديل + أقرب معاينة
--
-- الصلاحيات (قرار أكتوبر 2026):
--   • المدير العام / مدير المبيعات: كل الليدات — وصول كامل
--   • السيلز: ليداته (نفس RLS) وصول كامل، وليدات زمايله «مكان فقط»:
--       الاسم + آخر 4 أرقام + المرحلة + المسؤول — من غير فتح الملف ولا مبالغ ولا معاينات
--   • المنسقة: مرضاها هي بس (owner/coordinator/منسقة الديل) — لا البول ولا مرضى غيرها
--   • المحاسب: الليدات اللي عليها ديلات — مسؤول البلازما: اللي عليها باقات

-- ── 1) توحيد الحروف العربية: أ/إ/آ/ٱ→ا، ة→ه، ى/ئ→ي، ؤ→و + حذف التشكيل والتطويل
create or replace function public.ar_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
           regexp_replace(lower(coalesce(p, '')), '[ًٌٍَُِّْٰـ]', '', 'g'),
           'أإآٱةىئؤ',
           'ااااهييو')
$$;

create index if not exists idx_leads_name_norm_trgm
  on public.leads using gin (public.ar_norm(full_name) gin_trgm_ops);

-- ── 2) دالة البحث
-- v2: نفس global_search + stage_code / stage_category / last_activity (لخط رحلة المريض)
-- اتعملت باسم جديد بدل drop للقديمة — global_search (v1) مبقتش مستخدمة ويتشال براحتنا
create or replace function public.global_search_v2(p_q text, p_limit int default 20)
returns table (
  lead_id        bigint,
  access         text,      -- full | limited
  full_name      text,
  phone          text,      -- كامل للوصول الكامل، مخفي («•••• 1234») للمحدود
  file_no        text,
  board          text,      -- sales | coordinator
  stage_name     text,
  stage_name_en  text,
  stage_color    text,
  stage_code     text,
  stage_category text,
  last_activity  timestamptz,
  owner_id       uuid,
  owner_name     text,
  coordinator_name text,
  branch_name    text,
  branch_name_en text,
  archived       boolean,
  is_mine        boolean,
  deal_id        bigint,
  deal_status    text,
  deal_count     int,
  deal_total     numeric,
  deal_collected numeric,
  appt_date      date,
  appt_time      time,
  appt_status    text,
  prp_package_id bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_role  text := public.current_role_code();
  v_q     text := btrim(coalesce(p_q, ''));
  v_norm  text;
  v_digits text;
  v_terms text[];
  v_main  text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_uid is null or v_role is null or not public.is_active_user() then
    return;
  end if;

  v_digits := regexp_replace(v_q, '\D', '', 'g');
  -- رقم: نشيل الأصفار في الأول (05.. / 00966..) — الباقي جوه phone_norm
  v_digits := ltrim(v_digits, '0');
  v_norm := btrim(regexp_replace(public.ar_norm(v_q), '\s+', ' ', 'g'));

  -- لازم 3 حروف على الأقل (أو 4 أرقام) — يمنع سرد الداتا كلها
  if length(v_norm) < 3 and length(v_digits) < 4 then
    return;
  end if;

  v_terms := array(select t from unnest(string_to_array(v_norm, ' ')) t where t <> '');
  -- أطول كلمة هي اللي بتستخدم الفهرس، والباقي فلتر
  select t into v_main from unnest(v_terms) t order by length(t) desc limit 1;

  return query
  with cand as (
    select l.*
    from leads l
    where
      (length(v_main) >= 2
        and public.ar_norm(l.full_name) like '%' || v_main || '%'
        and not exists (select 1 from unnest(v_terms) t
                        where public.ar_norm(l.full_name) not like '%' || t || '%'))
      or (length(v_digits) >= 4 and l.phone_norm like '%' || v_digits || '%')
      or (length(v_q) >= 3 and l.file_no ilike '%' || v_q || '%')
  ),
  scoped as (
    select c.*,
      case
        when v_role in ('super_admin', 'sales_manager') then 'full'
        when v_role = 'agent' then
          case when c.owner_id = v_uid or c.coordinator_id = v_uid or c.owner_id is null
                 or exists (select 1 from deals d where d.lead_id = c.id and d.coordinator_id = v_uid)
               then 'full' else 'limited' end
        when v_role = 'coordinator' then
          case when c.owner_id = v_uid or c.coordinator_id = v_uid
                 or exists (select 1 from deals d where d.lead_id = c.id and d.coordinator_id = v_uid)
               then 'full' end
        when v_role = 'accountant' then
          case when exists (select 1 from deals d where d.lead_id = c.id) then 'full' end
        when v_role = 'prp_officer' then
          case when exists (select 1 from prp_packages pk where pk.lead_id = c.id) then 'full' end
      end as acc,
      (c.owner_id = v_uid or c.coordinator_id = v_uid) as mine,
      case
        when v_digits <> '' and length(v_digits) >= 4 and c.phone_norm like '%' || v_digits then 0
        when lower(c.file_no) = lower(v_q) then 0
        when public.ar_norm(c.full_name) = v_norm then 1
        when public.ar_norm(c.full_name) like v_norm || '%' then 2
        else 3
      end as rnk
    from cand c
  )
  select
    s.id,
    s.acc,
    s.full_name,
    case when s.acc = 'full' then s.phone
         else '•••• ' || right(coalesce(s.phone_norm, ''), 4) end,
    s.file_no,
    st.board,
    st.name_ar,
    st.name_en,
    st.color,
    st.code,
    st.category,
    s.last_activity,
    s.owner_id,
    po.full_name,
    pc.full_name,
    case when s.acc = 'full' then b.name end,
    case when s.acc = 'full' then b.name_en end,
    s.archived_at is not null,
    coalesce(s.mine, false),
    dl.id,
    dl.status,
    dl.cnt,
    dl.total_amount,
    dl.collected,
    ap.appt_date,
    ap.appt_time,
    ap.status,
    pp.id
  from scoped s
  left join stages st   on st.id = s.stage_id
  left join profiles po on po.id = s.owner_id
  left join profiles pc on pc.id = s.coordinator_id
  left join branches b  on b.id = s.branch_id
  -- آخر ديل (لو مسموح له يشوف الديل)
  left join lateral (
    select d.id, d.status, d.total_amount,
      (select coalesce(sum(p.amount), 0) from payments p
        where p.deal_id = d.id and p.status = 'active') as collected,
      (select count(*)::int from deals d2 where d2.lead_id = s.id) as cnt
    from deals d
    where s.acc = 'full' and d.lead_id = s.id
      and (v_role in ('super_admin', 'sales_manager', 'accountant')
           or d.agent_id = v_uid or d.coordinator_id = v_uid
           or v_role = 'prp_officer')
    order by d.created_at desc
    limit 1
  ) dl on true
  -- المعاينة: الجاية لو فيه، وإلا آخر واحدة
  left join lateral (
    select a.appt_date, a.appt_time, a.status
    from appointments a
    where s.acc = 'full' and a.lead_id = s.id and a.status <> 'rescheduled'
      and v_role in ('super_admin', 'sales_manager', 'agent', 'coordinator')
    order by (a.appt_date >= current_date) desc,
             case when a.appt_date >= current_date then a.appt_date end asc,
             a.appt_date desc, a.appt_time desc
    limit 1
  ) ap on true
  left join lateral (
    select pk.id from prp_packages pk
    where s.acc = 'full' and pk.lead_id = s.id and pk.status = 'active'
      and (v_role in ('super_admin', 'sales_manager', 'prp_officer')
           or exists (select 1 from deals d where d.id = pk.deal_id
                      and (d.agent_id = v_uid or d.coordinator_id = v_uid)))
    order by pk.created_at desc
    limit 1
  ) pp on true
  where s.acc is not null
  order by s.rnk, (s.acc = 'full') desc, coalesce(s.mine, false) desc,
           s.last_activity desc nulls last
  limit v_limit;
end;
$$;

revoke all on function public.global_search_v2(text, int) from public, anon;
grant execute on function public.global_search_v2(text, int) to authenticated;
