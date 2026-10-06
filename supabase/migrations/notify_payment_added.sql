-- إشعار "تحصيل جديد" للمحاسب والمديرين (المدير العام + مدير المبيعات)
-- - اللي سجّل الدفعة ميوصلوش (notify() بتتخطى auth.uid() لوحدها)
-- - لما الدفعة تتأكد محاسبيًا أو تتلغي، الإشعار يتقفل (يتعلّم مقروء) عند الكل
-- - أي خطأ في الإشعار مبيوقفش تسجيل الدفعة (raise warning بس)

create or replace function public.notify_payment_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_lead record; v_by text; v_data jsonb; r record;
begin
  if new.status is distinct from 'active' then return null; end if;

  select l.full_name, l.file_no into v_lead
  from public.deals d join public.leads l on l.id = d.lead_id where d.id = new.deal_id;
  select full_name into v_by from public.profiles where id = new.received_by;

  v_data := jsonb_build_object(
    'name', v_lead.full_name, 'file_no', v_lead.file_no, 'amount', new.amount,
    'method', new.method, 'receipt_no', new.receipt_no, 'by', v_by);

  for r in select p.id from public.profiles p join public.roles ro on ro.id = p.role_id
           where p.status = 'active' and ro.code in ('super_admin', 'sales_manager', 'accountant')
  loop
    perform public.notify(r.id, 'payment_added',
      'تحصيل جديد: ' || coalesce(v_lead.full_name, ''),
      coalesce(new.receipt_no, '') || ' · ' || new.amount || ' ر.س',
      'payments', new.id::text, v_data, 'pay_added:' || new.id);
  end loop;
  return null;
exception when others then
  raise warning 'notify payment added failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_notify_payment_added on public.payments;
create trigger trg_notify_payment_added
  after insert on public.payments
  for each row execute function public.notify_payment_added();

-- اتأكدت أو اتلغت → مفيش حاجة مستنية حد، نقفل الإشعار عند الكل
create or replace function public.close_payment_added_notif()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.confirmed_at is null and new.confirmed_at is not null)
     or (old.status = 'active' and new.status = 'void') then
    update public.notifications set is_read = true, updated_at = now()
    where type = 'payment_added' and entity_id = new.id::text and not is_read;
  end if;
  return null;
exception when others then
  raise warning 'close payment notif failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_close_payment_added_notif on public.payments;
create trigger trg_close_payment_added_notif
  after update of confirmed_at, status on public.payments
  for each row execute function public.close_payment_added_notif();

revoke all on function public.notify_payment_added() from public, anon, authenticated;
revoke all on function public.close_payment_added_notif() from public, anon, authenticated;
