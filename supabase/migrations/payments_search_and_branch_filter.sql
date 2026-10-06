-- التحصيلات: بحث بالاسم/الهاتف/رقم الملف/الإيصال + فلتر الفرع (اتطبّق على Supabase)
-- أعمدة محسوبة على payments يقدر PostgREST يفلتر عليها مباشرة (pay_search / pay_branch_id)

create or replace function public.pay_search(p public.payments)
returns text language sql stable set search_path = public as $$
  select concat_ws(' ', p.receipt_no, l.full_name, l.phone_norm, l.phone, l.file_no)
  from public.deals d left join public.leads l on l.id = d.lead_id
  where d.id = p.deal_id
$$;

create or replace function public.pay_branch_id(p public.payments)
returns bigint language sql stable set search_path = public as $$
  select l.branch_id from public.deals d join public.leads l on l.id = d.lead_id
  where d.id = p.deal_id
$$;

revoke all on function public.pay_search(public.payments) from public, anon;
revoke all on function public.pay_branch_id(public.payments) from public, anon;
grant execute on function public.pay_search(public.payments) to authenticated;
grant execute on function public.pay_branch_id(public.payments) to authenticated;

drop function if exists public.payment_totals(timestamptz, timestamptz, text, text);

create or replace function public.payment_totals(
  p_from timestamptz default null, p_to timestamptz default null,
  p_method text default null, p_search text default null, p_branch bigint default null
)
returns jsonb language sql stable security definer set search_path = public as $$
  with f as (
    select p.*, d.lead_id
    from public.payments p
    join public.deals d on d.id = p.deal_id
    left join public.leads l on l.id = d.lead_id
    where can_see_deal(d.agent_id, d.coordinator_id)
      and (p_from   is null or p.paid_at >= p_from)
      and (p_to     is null or p.paid_at <= p_to)
      and (p_branch is null or l.branch_id = p_branch)
      and (p_method is null
           or (p_method = 'card_all' and p.method in ('card', 'mada', 'visa', 'mastercard'))
           or p.method = p_method)
      and (p_search is null or p_search = ''
           or concat_ws(' ', p.receipt_no, l.full_name, l.phone_norm, l.phone, l.file_no)
              ilike '%' || p_search || '%')
  )
  select jsonb_build_object(
    'count',             (select count(*) from f),
    'active_count',      (select count(*) from f where status = 'active'),
    'active_total',      (select coalesce(sum(amount), 0) from f where status = 'active'),
    'unconfirmed',       (select count(*) from f where status = 'active' and confirmed_at is null),
    'unconfirmed_total', (select coalesce(sum(amount), 0) from f where status = 'active' and confirmed_at is null),
    'void_requested',    (select count(*) from f where status = 'void_requested'),
    'void_total',        (select coalesce(sum(amount), 0) from f where status = 'void')
  );
$$;

revoke all on function public.payment_totals(timestamptz, timestamptz, text, text, bigint) from public, anon;
grant execute on function public.payment_totals(timestamptz, timestamptz, text, text, bigint) to authenticated;

notify pgrst, 'reload schema';
