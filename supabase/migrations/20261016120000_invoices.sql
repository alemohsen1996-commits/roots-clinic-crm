-- =====================================================================
-- الفواتير الضريبية المبسطة — فاتورة لكل دفعة
-- * ضريبة الدفعة (vat_amount) بتكتبها المنسقة يدوي — المبلغ شامل الضريبة
-- * الفاتورة بتطلع تلقائي مع تسجيل الدفعة (record_payment_v2)، أو بزرار لدفعة قديمة (issue_invoice)
-- * ترقيم واحد للشركة: INV-YYYY-000001
-- * QR بصيغة هيئة الزكاة (TLV / Base64): البائع، الرقم الضريبي، الوقت، الإجمالي، الضريبة
-- * ضريبة الديل = مجموع ضرائب الدفعات (لما كل دفعات الديل يبقى ليها ضريبة مسجلة)
-- * بيانات المريض الاختيارية: رقم الهوية/الإقامة، الجنسية، الجنس
-- * بيانات الشركة في settings: invoice_seller (JSON) و invoice_stamp (صورة الختم data URL)
-- =====================================================================

-- ---------- 1) ضريبة الدفعة ----------
alter table public.payments add column if not exists vat_amount numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_vat_chk') then
    alter table public.payments add constraint payments_vat_chk
      check (vat_amount is null or (vat_amount >= 0 and vat_amount < amount));
  end if;
end $$;

-- ---------- 2) بيانات المريض للفاتورة (اختيارية) ----------
alter table public.leads add column if not exists national_id text;
alter table public.leads add column if not exists nationality text;
alter table public.leads add column if not exists gender text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_gender_chk') then
    alter table public.leads add constraint leads_gender_chk check (gender is null or gender in ('male', 'female'));
  end if;
end $$;

-- ---------- 3) ضريبة الديل محسوبة من الدفعات ----------
alter table public.deals add column if not exists tax_from_payments boolean not null default false;

-- ---------- 4) الفواتير ----------
create sequence if not exists public.invoice_seq;

create table if not exists public.invoices (
  id          bigserial primary key,
  invoice_no  text not null unique,
  payment_id  bigint not null references public.payments(id),
  deal_id     bigint not null references public.deals(id),
  issued_at   timestamptz not null default now(),
  issued_by   uuid references public.profiles(id),
  amount      numeric not null,                 -- الإجمالي شامل الضريبة
  vat_amount  numeric not null,
  subtotal    numeric generated always as (amount - vat_amount) stored,
  seller      jsonb not null,                   -- لقطة من بيانات الشركة وقت الإصدار
  qr_tlv      text not null,
  status      text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text
);

-- فاتورة سارية واحدة بس لكل دفعة (الملغاة ممكن يتعمل بدلها)
create unique index if not exists uq_invoices_payment_issued
  on public.invoices(payment_id) where status = 'issued';
create index if not exists idx_invoices_deal on public.invoices(deal_id);

alter table public.invoices enable row level security;

-- القراءة: أي حد يقدر يشوف الدفعة يقدر يشوف فاتورتها — مفيش كتابة مباشرة، كله عن طريق الدوال
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'قراءة الفواتير') then
    create policy "قراءة الفواتير" on public.invoices for select
      using (exists (select 1 from public.payments p where p.id = invoices.payment_id));
  end if;
end $$;

grant select on public.invoices to authenticated;

-- ---------- 5) QR هيئة الزكاة ----------
create or replace function public._zatca_tlv(p_tag int, p_val text)
returns bytea language sql immutable set search_path = public as $$
  select set_byte(set_byte('\x0000'::bytea, 0, p_tag), 1, octet_length(convert_to(coalesce(p_val, ''), 'UTF8')))
         || convert_to(coalesce(p_val, ''), 'UTF8')
$$;

create or replace function public._zatca_qr(p_seller text, p_vat_no text, p_at timestamptz, p_total numeric, p_vat numeric)
returns text language sql immutable set search_path = public as $$
  select replace(encode(
           public._zatca_tlv(1, p_seller)
        || public._zatca_tlv(2, p_vat_no)
        || public._zatca_tlv(3, to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        || public._zatca_tlv(4, to_char(p_total, 'FM999999990.00'))
        || public._zatca_tlv(5, to_char(p_vat, 'FM999999990.00')),
         'base64'), E'\n', '')
$$;

-- ---------- 6) مزامنة ضريبة الديل ----------
-- ضريبة الديل = مجموع ضرائب الدفعات غير الملغاة، بشرط إن كل الدفعات دي ليها ضريبة مسجلة
-- (الديلات القديمة اللي فيها دفعات من غير ضريبة بتفضل بضريبتها اليدوية، والديل المقفول محاسبيًا مايتغيرش)
create or replace function public.trg_payment_tax_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deal bigint; v_n int; v_null int; v_sum numeric; v_locked boolean;
begin
  foreach v_deal in array array_remove(array[
      case when tg_op <> 'DELETE' then new.deal_id end,
      case when tg_op <> 'INSERT' and (tg_op = 'DELETE' or old.deal_id is distinct from new.deal_id) then old.deal_id end
    ], null)
  loop
    select count(*) filter (where status <> 'void'),
           count(*) filter (where status <> 'void' and vat_amount is null),
           coalesce(sum(vat_amount) filter (where status <> 'void'), 0)
      into v_n, v_null, v_sum
    from public.payments where deal_id = v_deal;

    select is_locked into v_locked from public.deals where id = v_deal;
    if v_n = 0 or v_null > 0 or coalesce(v_locked, false) then continue; end if;

    perform set_config('app.tax_sync', 'on', true);
    update public.deals
       set tax_amount = v_sum, tax_from_payments = true
     where id = v_deal
       and (tax_amount is distinct from v_sum or not tax_from_payments);
    perform set_config('app.tax_sync', 'off', true);
  end loop;
  return null;
end $$;

create or replace trigger trg_payment_tax_sync
  after insert or update of vat_amount, status, amount, deal_id on public.payments
  for each row execute function public.trg_payment_tax_sync();

-- حماية تعديل الديل: المزامنة التلقائية للضريبة مسموحة لأي حد بيسجل دفعة
create or replace function public.guard_deal_edit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role       text;
  v_money_edit boolean;
  v_field_edit boolean;
begin
  -- عمليات النظام (service_role / إدج فنكشن) بلا مستخدم → مسموح
  if auth.uid() is null then
    return new;
  end if;

  -- مزامنة ضريبة الديل من ضرائب الدفعات (trg_payment_tax_sync)
  if current_setting('app.tax_sync', true) = 'on' then
    return new;
  end if;

  v_role := public.current_role_code();

  -- المدير له كل الصلاحيات
  if v_role in ('super_admin', 'sales_manager') then
    return new;
  end if;

  v_money_edit :=
       new.total_amount is distinct from old.total_amount
    or new.tax_amount   is distinct from old.tax_amount;

  v_field_edit :=
       new.procedure_type_id is distinct from old.procedure_type_id
    or new.doctor_id         is distinct from old.doctor_id
    or new.grafts            is distinct from old.grafts
    or new.operation_date    is distinct from old.operation_date
    or new.notes             is distinct from old.notes
    or new.tax_note          is distinct from old.tax_note;

  -- المبالغ (السعر + الضريبة): المنسقة والمحاسب والمدير
  if v_money_edit and v_role not in ('coordinator', 'accountant') then
    raise exception 'غير مصرح: تعديل المبالغ يتم عبر المنسقة أو المحاسب أو المدير';
  end if;

  if v_field_edit and v_role not in ('coordinator', 'accountant') then
    raise exception 'غير مصرح: تعديل بيانات العملية يتم عبر المنسقة أو المحاسب أو المدير';
  end if;

  return new;
end $function$;

-- المزامنة التلقائية ما تبعتش إشعار "تعديل بيانات" للمحاسب (هو أصلاً بيوصله إشعار الدفعة)
create or replace trigger trg_notify_deal_edit
  after update on public.deals
  for each row
  when (current_setting('app.tax_sync', true) is distinct from 'on')
  execute function public.notify_deal_edit();

-- ---------- 7) إصدار الفاتورة ----------
-- p_vat: ضريبة الدفعة — مطلوبة لو الدفعة مالهاش ضريبة مسجلة (دفعة قديمة)
-- لو فيه فاتورة سارية للدفعة بترجع رقمها من غير ما تعمل جديدة
create or replace function public.issue_invoice(p_payment_id bigint, p_vat numeric default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_pay    public.payments%rowtype;
  v_deal   public.deals%rowtype;
  v_seller jsonb;
  v_vat    numeric;
  v_id     bigint;
  v_no     text;
  v_at     timestamptz := now();
begin
  if v_uid is null then raise exception 'غير مسجل الدخول'; end if;
  v_role := public.current_role_code();

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  select * into v_deal from public.deals where id = v_pay.deal_id;

  -- نفس صلاحية قراءة الدفعة
  if not (v_role in ('super_admin', 'sales_manager', 'accountant')
          or v_deal.coordinator_id = v_uid or v_deal.agent_id = v_uid) then
    raise exception 'غير مصرح بإصدار فاتورة لهذه الدفعة';
  end if;

  if v_pay.status <> 'active' then
    raise exception 'لا يمكن إصدار فاتورة لدفعة ملغاة أو عليها طلب إلغاء';
  end if;

  select id into v_id from public.invoices where payment_id = p_payment_id and status = 'issued';
  if v_id is not null then return v_id; end if;

  v_vat := coalesce(p_vat, v_pay.vat_amount);
  if v_vat is null then raise exception 'اكتب ضريبة الدفعة (ولو صفر) قبل إصدار الفاتورة'; end if;
  if v_vat < 0 or v_vat >= v_pay.amount then raise exception 'الضريبة لازم تكون أقل من مبلغ الدفعة'; end if;

  if v_pay.vat_amount is distinct from v_vat then
    update public.payments set vat_amount = v_vat where id = p_payment_id;
  end if;

  select value into v_seller from public.settings where key = 'invoice_seller';
  if v_seller is null or coalesce(v_seller->>'vat_no', '') = '' or coalesce(v_seller->>'name_ar', '') = '' then
    raise exception 'بيانات الشركة للفاتورة غير مكتملة — كمّلها من الإعدادات';
  end if;

  v_no := 'INV-' || to_char(v_at at time zone 'Asia/Riyadh', 'YYYY') || '-'
          || lpad(nextval('public.invoice_seq')::text, 6, '0');

  insert into public.invoices (invoice_no, payment_id, deal_id, issued_at, issued_by,
                               amount, vat_amount, seller, qr_tlv)
  values (v_no, p_payment_id, v_pay.deal_id, v_at, v_uid, v_pay.amount, v_vat, v_seller,
          public._zatca_qr(v_seller->>'name_ar', v_seller->>'vat_no', v_at, v_pay.amount, v_vat))
  returning id into v_id;

  return v_id;
end $$;

-- ---------- 8) إلغاء الفاتورة (المحاسب والمديرين) ----------
create or replace function public.cancel_invoice(p_invoice_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if coalesce(public.current_role_code(), '') not in ('super_admin', 'sales_manager', 'accountant') then
    raise exception 'إلغاء الفاتورة يتطلب صلاحية مدير أو محاسب';
  end if;
  if v_reason is null then raise exception 'سبب الإلغاء مطلوب'; end if;

  update public.invoices
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
   where id = p_invoice_id and status = 'issued';
  if not found then raise exception 'الفاتورة غير موجودة أو ملغاة بالفعل'; end if;
end $$;

-- إلغاء الدفعة → فاتورتها تتلغي تلقائي
create or replace function public.trg_payment_void_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update public.invoices
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_reason = coalesce('إلغاء الدفعة: ' || new.void_reason, 'إلغاء الدفعة')
     where payment_id = new.id and status = 'issued';
  end if;
  return null;
end $$;

create or replace trigger trg_payment_void_invoice
  after update of status on public.payments
  for each row execute function public.trg_payment_void_invoice();

-- ---------- 9) تسجيل الدفعة بضريبتها + فاتورة تلقائية ----------
-- record_payment_at القديمة فاضلة زي ما هي للتوافق
create or replace function public.record_payment_v2(
  p_deal_id bigint, p_amount numeric, p_method text, p_vat numeric,
  p_reference text default null, p_notes text default null,
  p_installment_id bigint default null, p_receipt_path text default null,
  p_paid_at date default null)
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
  v_payment_id bigint;
  v_inst       public.installments%rowtype;
  v_new_paid   numeric;
  v_today      date := (now() at time zone 'Asia/Riyadh')::date;
  v_paid_at    timestamptz;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ غير صالح';
  end if;
  if p_method = 'card' then
    raise exception 'اختر نوع الشبكة: مدى أو فيزا أو ماستركارد';
  end if;
  if p_vat is null then
    raise exception 'اكتب ضريبة الدفعة (ولو صفر)';
  end if;
  if p_vat < 0 or p_vat >= p_amount then
    raise exception 'الضريبة لازم تكون أقل من مبلغ الدفعة';
  end if;

  if p_paid_at is null or p_paid_at = v_today then
    v_paid_at := now();
  elsif p_paid_at > v_today then
    raise exception 'تاريخ التحصيل لا يمكن أن يكون في المستقبل';
  elsif p_paid_at < date '2023-01-01' then
    raise exception 'تاريخ التحصيل غير منطقي — راجع السنة';
  else
    v_paid_at := (p_paid_at + time '12:00') at time zone 'Asia/Riyadh';
  end if;

  insert into public.payments (deal_id, amount, method, reference, notes, received_by, receipt_path, paid_at, vat_amount)
  values (p_deal_id, p_amount, p_method,
          nullif(p_reference, ''), nullif(p_notes, ''), auth.uid(), nullif(p_receipt_path, ''), v_paid_at, p_vat)
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

  perform public.issue_invoice(v_payment_id, p_vat);

  return v_payment_id;
end $function$;

grant execute on function public.issue_invoice(bigint, numeric) to authenticated;
grant execute on function public.cancel_invoice(bigint, text) to authenticated;
grant execute on function public.record_payment_v2(bigint, numeric, text, numeric, text, text, bigint, text, date) to authenticated;
