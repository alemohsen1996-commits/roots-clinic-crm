-- تاريخ التحصيل في تسجيل الدفعة: لإدخال دفعات العمليات القديمة بتاريخها الحقيقي
-- دالة جديدة record_payment_at (القديمة record_payment بقت بتحوّل لها)
-- p_paid_at اختياري: فاضي أو النهارده = وقت التسجيل الحالي (زي الأول)
-- تاريخ قديم = الساعة 12 ظهرًا بتوقيت الرياض لنفس اليوم (عشان المنطقة الزمنية ما تنقلهوش ليوم تاني)
-- created_at بيفضل وقت الإدخال الفعلي — فالمحاسب يقدر يميّز الدفعات المسجّلة بأثر رجعي

create or replace function public.record_payment_at(
  p_deal_id bigint,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_notes text default null,
  p_installment_id bigint default null,
  p_receipt_path text default null,
  p_paid_at date default null
)
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

  if p_paid_at is null or p_paid_at = v_today then
    v_paid_at := now();
  elsif p_paid_at > v_today then
    raise exception 'تاريخ التحصيل لا يمكن أن يكون في المستقبل';
  elsif p_paid_at < date '2023-01-01' then
    raise exception 'تاريخ التحصيل غير منطقي — راجع السنة';
  else
    v_paid_at := (p_paid_at + time '12:00') at time zone 'Asia/Riyadh';
  end if;

  insert into public.payments (deal_id, amount, method, reference, notes, received_by, receipt_path, paid_at)
  values (p_deal_id, p_amount, p_method,
          nullif(p_reference, ''), nullif(p_notes, ''), auth.uid(), nullif(p_receipt_path, ''), v_paid_at)
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

revoke all on function public.record_payment_at(bigint, numeric, text, text, text, bigint, text, date) from public, anon;
grant execute on function public.record_payment_at(bigint, numeric, text, text, text, bigint, text, date) to authenticated, service_role;

-- القديمة بتحوّل للجديدة (نفس السلوك: تاريخ التحصيل = الآن) عشان المنطق يفضل في مكان واحد
create or replace function public.record_payment(
  p_deal_id bigint, p_amount numeric, p_method text,
  p_reference text default null, p_notes text default null,
  p_installment_id bigint default null, p_receipt_path text default null
)
returns bigint
language sql
set search_path to 'public'
as $$
  select public.record_payment_at(p_deal_id, p_amount, p_method, p_reference, p_notes,
                                  p_installment_id, p_receipt_path, null)
$$;

notify pgrst, 'reload schema';
