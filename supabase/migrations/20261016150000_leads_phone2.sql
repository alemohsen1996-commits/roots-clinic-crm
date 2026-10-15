-- =====================================================================
-- رقم تاني للمريض (phone2)
-- * phone2_norm (أرقام بس) للبحث والمطابقة
-- * check_duplicate_phone: الرقم الجديد بيتقارن بالرقم الأساسي والتاني لكل الليدات
-- * global_search_v2: البحث بالرقم بيلاقي الرقم التاني كمان
-- * relink_calls: مكالمات السنترال بتترَبط بالليد بالرقم التاني لو مالقتش الأساسي
-- * wa-lead (Edge Function): رسالة واتساب من الرقم التاني بتروح لنفس الليد بدل ما تعمل ليد جديد
-- =====================================================================

alter table public.leads add column if not exists phone2 text;
alter table public.leads add column if not exists phone2_norm text
  generated always as (nullif(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g'), '')) stored;
create index if not exists idx_leads_phone2_norm on public.leads (phone2_norm) where phone2_norm is not null;
create index if not exists idx_leads_phone2_norm_trgm on public.leads using gin (phone2_norm gin_trgm_ops);

create or replace function public.check_duplicate_phone(p_phone text)
 returns table(lead_id bigint, file_no text, full_name text, stage text, owner text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select l.id, l.file_no, l.full_name, s.name_ar, p.full_name
  from public.leads l
  join public.stages s on s.id = l.stage_id
  left join public.profiles p on p.id = l.owner_id
  where l.phone_norm = regexp_replace(p_phone, '[^0-9]', '', 'g')
     or l.phone2_norm = regexp_replace(p_phone, '[^0-9]', '', 'g');
$function$;

create or replace function public.relink_calls()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_users int; v_leads int; v_leads2 int;
begin
  update calls c set user_id = p.id
    from profiles p where c.user_id is null and p.phone_ext = c.extension;
  get diagnostics v_users = row_count;

  update calls c set lead_id = x.id
    from (select distinct on (phone_norm) id, phone_norm from leads
          where phone_norm is not null
          order by phone_norm, (archived_at is null) desc, created_at desc) x
   where c.lead_id is null and x.phone_norm = c.client_phone;
  get diagnostics v_leads = row_count;

  update calls c set lead_id = x.id
    from (select distinct on (phone2_norm) id, phone2_norm from leads
          where phone2_norm is not null
          order by phone2_norm, (archived_at is null) desc, created_at desc) x
   where c.lead_id is null and x.phone2_norm = c.client_phone;
  get diagnostics v_leads2 = row_count;

  return jsonb_build_object('users_linked', v_users, 'leads_linked', v_leads + v_leads2);
end $function$;

-- البحث الشامل: نفس الدالة مع إضافة phone2_norm لشرط المطابقة وللترتيب
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.global_search_v2(text,integer)'::regprocedure);
  if d like '%l.phone2_norm like%' then return; end if;
  n := replace(d,
    $a$or (length(v_digits) >= 4 and l.phone_norm like '%' || v_digits || '%')$a$,
    $a$or (length(v_digits) >= 4 and (l.phone_norm like '%' || v_digits || '%' or l.phone2_norm like '%' || v_digits || '%'))$a$);
  n := replace(n,
    $a$when v_digits <> '' and length(v_digits) >= 4 and c.phone_norm like '%' || v_digits then 0$a$,
    $a$when v_digits <> '' and length(v_digits) >= 4 and (c.phone_norm like '%' || v_digits or c.phone2_norm like '%' || v_digits) then 0$a$);
  if n = d or n not like '%l.phone2_norm like%' or n not like '%c.phone2_norm like%' then
    raise exception 'global_search_v2: pattern not found';
  end if;
  execute n;
end $$;
