-- عدّادات الشرائح في استعلام واحد بدل 7–13 استعلامًا
-- الصلاحية تُشتق من auth.uid() لا من الواجهة (لا يمكن للسيلز طلب نطاق المدير)
-- security definer + الـ view أصلاً definer، فالعدّ كامل بصرف النظر عن RLS المستدعي
create or replace function public.chip_counts(p_stage_ids int[])
returns table (
  alert_only   bigint,
  task_today   bigint,
  task_overdue bigint,
  no_task      bigint,
  paused       bigint,
  no_owner     bigint,
  stale        bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  select r.code into v_role
  from profiles p join roles r on r.id = p.role_id
  where p.id = v_uid;

  return query
  select
    count(*) filter (where v.alert_days > 0),
    count(*) filter (where v.task_today),
    count(*) filter (where v.task_overdue),
    count(*) filter (where v.open_tasks = 0),
    count(*) filter (where v.follow_paused),
    count(*) filter (where v.owner_id is null),
    count(*) filter (where v.last_activity < now() - interval '7 days')
  from v_lead_flags v
  where v.stage_id = any(p_stage_ids)
    and v.archived_at is null
    and (
      v_role in ('super_admin','sales_manager')
      or (v_role = 'coordinator' and v.coordinator_id = v_uid)
      or (v_role not in ('super_admin','sales_manager','coordinator')
          and (v.owner_id = v_uid or v.owner_id is null))
    );
end;
$$;

revoke all on function public.chip_counts(int[]) from public;
grant execute on function public.chip_counts(int[]) to authenticated;