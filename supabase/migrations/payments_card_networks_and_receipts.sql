-- التحصيلات: شبكة مفصّلة (مدى/فيزا/ماستركارد) + صورة إيصال إجبارية لكل دفعة جديدة

-- 1) طرق الدفع — "card" يفضل للتسجيلات القديمة بس
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'mada', 'visa', 'mastercard', 'transfer', 'tabby', 'tamara', 'other'));

-- 2) صورة الإيصال
alter table public.payments add column if not exists receipt_path text;

-- 3) مساحة تخزين خاصة للإيصالات (صور + PDF، أقصى 5MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "رفع إيصالات الدفعات" on storage.objects;
create policy "رفع إيصالات الدفعات" on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "عرض إيصالات الدفعات" on storage.objects;
create policy "عرض إيصالات الدفعات" on storage.objects for select to authenticated
using (bucket_id = 'receipts' and (
  owner = (select auth.uid())
  or exists (select 1 from public.payments p where p.receipt_path = objects.name)
));

drop policy if exists "مسح إيصال غير مربوط" on storage.objects;
create policy "مسح إيصال غير مربوط" on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and owner = (select auth.uid())
       and not exists (select 1 from public.payments p where p.receipt_path = objects.name));

-- 4) أي دفعة جديدة لازم يبقى معاها إيصال مرفوع فعلًا
create or replace function public.require_payment_receipt()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.receipt_path is null or new.receipt_path = '' then
    raise exception 'صورة الإيصال مطلوبة لتسجيل الدفعة' using errcode = 'P0001', hint = 'receipt_required';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = new.receipt_path) then
    raise exception 'صورة الإيصال مش موجودة — ارفعها تاني' using errcode = 'P0001', hint = 'receipt_missing';
  end if;
  return new;
end $$;

drop trigger if exists trg_require_payment_receipt on public.payments;
create trigger trg_require_payment_receipt
  before insert on public.payments
  for each row execute function public.require_payment_receipt();

create or replace function public.check_payment_receipt_update()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.receipt_path is distinct from old.receipt_path then
    if new.receipt_path is null then
      raise exception 'مينفعش تشيل صورة الإيصال' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = new.receipt_path) then
      raise exception 'صورة الإيصال مش موجودة — ارفعها تاني' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_payment_receipt_update on public.payments;
create trigger trg_check_payment_receipt_update
  before update of receipt_path on public.payments
  for each row execute function public.check_payment_receipt_update();

-- 5) record_payment: بياخد مسار الإيصال، ومابقاش يقبل "شبكة" من غير نوع
drop function if exists public.record_payment(bigint, numeric, text, text, text, bigint);
create or replace function public.record_payment(
  p_deal_id bigint, p_amount numeric, p_method text,
  p_reference text default null, p_notes text default null,
  p_installment_id bigint default null, p_receipt_path text default null
)
returns bigint language plpgsql set search_path to 'public' as $function$
declare
  v_payment_id bigint;
  v_inst       public.installments%rowtype;
  v_new_paid   numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ غير صالح';
  end if;
  if p_method = 'card' then
    raise exception 'اختر نوع الشبكة: مدى أو فيزا أو ماستركارد';
  end if;

  insert into public.payments (deal_id, amount, method, reference, notes, received_by, receipt_path)
  values (p_deal_id, p_amount, p_method,
          nullif(p_reference, ''), nullif(p_notes, ''), auth.uid(), nullif(p_receipt_path, ''))
  returning id into v_payment_id;

  if p_installment_id is not null then
    select * into v_inst from public.installments where id = p_installment_id for update;
    if not found then raise exception 'القسط المحدَّد غير موجود'; end if;
    if v_inst.deal_id <> p_deal_id then raise exception 'القسط لا يخص هذا الديل'; end if;

    v_new_paid := coalesce(v_inst.paid_amount, 0) + p_amount;
    update public.installments
    set paid_amount = v_new_paid,
        payment_id  = coalesce(payment_id, v_payment_id),
        status      = case when v_new_paid >= v_inst.amount then 'paid' else 'partial' end
    where id = p_installment_id;
  end if;

  return v_payment_id;
end $function$;
revoke all on function public.record_payment(bigint, numeric, text, text, text, bigint, text) from public, anon;
grant execute on function public.record_payment(bigint, numeric, text, text, text, bigint, text) to authenticated;

-- 6) إجماليات التحصيلات: "card_all" = كل الشبكة (القديم + مدى + فيزا + ماستركارد)
create or replace function public.payment_totals(
  p_from timestamptz default null, p_to timestamptz default null,
  p_method text default null, p_search text default null
)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with f as (
    select p.*, d.lead_id
    from public.payments p
    join public.deals d on d.id = p.deal_id
    left join public.leads l on l.id = d.lead_id
    where can_see_deal(d.agent_id, d.coordinator_id)
      and (p_from   is null or p.paid_at >= p_from)
      and (p_to     is null or p.paid_at <= p_to)
      and (p_method is null
           or (p_method = 'card_all' and p.method in ('card', 'mada', 'visa', 'mastercard'))
           or p.method = p_method)
      and (
        p_search is null or p_search = ''
        or p.receipt_no ilike '%' || p_search || '%'
        or l.full_name  ilike '%' || p_search || '%'
        or l.phone      ilike '%' || p_search || '%'
        or l.file_no    ilike '%' || p_search || '%'
      )
  )
  select jsonb_build_object(
    'count',          (select count(*)                     from f),
    'active_count',   (select count(*)                     from f where status = 'active'),
    'active_total',   (select coalesce(sum(amount), 0)     from f where status = 'active'),
    'unconfirmed',    (select count(*)                     from f where status = 'active' and confirmed_at is null),
    'unconfirmed_total', (select coalesce(sum(amount), 0)  from f where status = 'active' and confirmed_at is null),
    'void_requested', (select count(*)                     from f where status = 'void_requested'),
    'void_total',     (select coalesce(sum(amount), 0)     from f where status = 'void')
  );
$function$;
