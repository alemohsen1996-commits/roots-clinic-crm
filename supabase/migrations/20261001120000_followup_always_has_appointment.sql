-- ============================================================
-- كل ليد في «متابعة» لازم يظهر في المعاينات: محجوز في الجدول أو «بدون موعد» في قائمة الانتظار
-- المشكلة: 51 ليد في المتابعة من غير أي معاينة — اتنقلوا قبل تشغيل المعاينات (23 سبتمبر)،
-- وفيه طرق نقل تانية مابتعملش معاينة (النقل الجماعي، الاستيراد، التوزيع اليدوي، التراجع، إضافة ليد)
-- الحل: تريجر على leads يضمن معاينة نشطة + تعبئة الناقص مرة واحدة
-- ============================================================

-- فرع المعاينة: فرع الليد، وإلا الفرع اللي المنسقة شغالة عليه أكتر
create or replace function public.appt_default_branch(p_branch bigint, p_coordinator uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    p_branch,
    (select a.branch_id from public.appointments a
       join public.branches b on b.id = a.branch_id and b.is_active
      where a.coordinator_id = p_coordinator
      group by a.branch_id order by count(*) desc limit 1));
$$;
revoke all on function public.appt_default_branch(bigint, uuid) from public, anon, authenticated;

create or replace function public.ensure_followup_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_branch bigint;
begin
  if new.stage_id is distinct from (select id from public.stages where code = 'followup') then return null; end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return null; end if;
  if new.archived_at is not null then return null; end if;

  -- درج الليد بيحجز المعاينة قبل ما ينقل المرحلة → موجودة، مفيش حاجة نعملها
  if exists (select 1 from public.appointments
             where lead_id = new.id and status in ('pending', 'booked')) then
    return null;
  end if;

  v_branch := public.appt_default_branch(new.branch_id, new.coordinator_id);
  if v_branch is null then
    raise exception 'حدد فرع العميل «%» قبل تحويله للمتابعة', new.full_name;
  end if;

  insert into public.appointments (lead_id, branch_id, coordinator_id, status, created_by, callcenter_note)
  values (new.id, v_branch, new.coordinator_id, 'pending', auth.uid(),
          'اتضافت تلقائيًا عند التحويل للمتابعة');
  return null;
end $$;
revoke all on function public.ensure_followup_appointment() from public, anon, authenticated;

create trigger trg_ensure_followup_appointment
  after insert or update of stage_id on public.leads
  for each row execute function public.ensure_followup_appointment();

-- تعبئة الناقص: ليدات المتابعة اللي مالهاش معاينة نشطة → «بدون موعد»
insert into public.appointments (lead_id, branch_id, coordinator_id, status, callcenter_note)
select l.id, public.appt_default_branch(l.branch_id, l.coordinator_id), l.coordinator_id, 'pending',
       'اتضافت تلقائيًا — كان في المتابعة من غير معاينة'
from public.leads l
where l.stage_id = (select id from public.stages where code = 'followup')
  and l.archived_at is null
  and not exists (select 1 from public.appointments a
                  where a.lead_id = l.id and a.status in ('pending', 'booked'))
  and public.appt_default_branch(l.branch_id, l.coordinator_id) is not null;
