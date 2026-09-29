-- v_lead_flags أسرع بكتير (فلاتر التاسكات/المتأخر + أرقام الشرائح فوق البورد):
--  • التاسكات المفتوحة بتتجمّع مرة واحدة (join) بدل 7 استعلامات فرعية لكل ليد
--  • security definer مع حصر الصلاحية جوه الـ view (مفيش RLS متداخل لكل صف)
--    المدير = الكل، الموظف = ليداته أو اللي هو منسقها أو الـ pool — نفس نطاق chip_counts
--  • فحص الصلاحية initplan (مرة للاستعلام مش لكل صف)
-- النتايج اتطابقت 100% مع النسخة القديمة (md5 على كل الصفوف)
create or replace view public.v_lead_flags
with (security_invoker = false) as
with t as (
  select tk.lead_id,
         min(tk.due_at) as next_due,
         count(*)::bigint as open_tasks,
         bool_or(tk.due_at >= date_trunc('day', now()) and tk.due_at < date_trunc('day', now()) + interval '1 day') as task_today,
         bool_or(tk.due_at < now())  as task_overdue,
         bool_or(tk.due_at <= now()) as has_due
  from public.tasks tk
  where tk.status = 'open'
  group by tk.lead_id
)
select l.id as lead_id,
       l.stage_id,
       l.archived_at,
       l.owner_id,
       l.coordinator_id,
       t.next_due,
       coalesce(t.open_tasks, 0)::bigint as open_tasks,
       coalesce(t.task_today, false) as task_today,
       coalesce(t.task_overdue, false) as task_overdue,
       case
         when l.follow_paused then 0
         when s.category = any (array['won','lost']) or s.no_alert then 0
         when s.code = any (array['dead','lost','done','won']) then 0
         when l.snooze_until is not null and l.snooze_until > now() then 0
         when coalesce(t.has_due, false) then greatest(1, extract(day from (now() - t.next_due))::integer)
         when coalesce(t.open_tasks, 0) > 0 then 0
         when s.sla_hours is not null and s.sla_hours > 0 then
           case
             when (now() - coalesce(l.last_activity, now())) < make_interval(hours => s.sla_hours) then 0
             else floor(extract(epoch from ((now() - l.last_activity) - make_interval(hours => s.sla_hours))) / 86400)::integer + 1
           end
         else greatest(0, extract(day from (now() - coalesce(l.last_activity, now())))::integer)
       end as alert_days,
       l.source_id,
       l.branch_id,
       l.procedure_interest,
       l.created_at,
       l.last_activity,
       l.phone_norm,
       l.offered_price,
       l.age,
       l.follow_paused,
       l.snooze_until,
       l.full_name,
       l.file_no
from public.leads l
left join public.stages s on s.id = l.stage_id
left join t on t.lead_id = l.id
where (select public.is_manager_safe())
   or (select auth.uid()) is null
   or l.owner_id = (select auth.uid())
   or l.coordinator_id = (select auth.uid())
   or l.owner_id is null;

revoke all on public.v_lead_flags from anon;
