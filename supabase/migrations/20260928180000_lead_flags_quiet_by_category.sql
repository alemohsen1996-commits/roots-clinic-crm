-- العلامة الحمراء: المراحل المنتهية تتعرف بالفئة (won / lost) مش بالكود بس
-- قبل كده المراحل اللي اتضافت من الإعدادات (كودها stage_…) زي "عمليات قبل شهر سبتمبر"
-- و"غير مهتم" في بورد المنسقات كانت بتفضل تعد أيام إهمال للأبد
create or replace view public.v_lead_flags
with (security_invoker = off) as
select l.id as lead_id,
    l.stage_id,
    l.archived_at,
    l.owner_id,
    l.coordinator_id,
    (select min(t.due_at) from tasks t where t.lead_id = l.id and t.status = 'open') as next_due,
    (select count(*) from tasks t where t.lead_id = l.id and t.status = 'open') as open_tasks,
    (exists (select 1 from tasks t
              where t.lead_id = l.id and t.status = 'open'
                and t.due_at >= date_trunc('day', now())
                and t.due_at < date_trunc('day', now()) + interval '1 day')) as task_today,
    (exists (select 1 from tasks t
              where t.lead_id = l.id and t.status = 'open' and t.due_at < now())) as task_overdue,
    case
        when l.follow_paused then 0
        when s.category in ('won', 'lost') then 0
        when s.code = any (array['dead', 'lost', 'done', 'won']) then 0
        when l.snooze_until is not null and l.snooze_until > now() then 0
        when (exists (select 1 from tasks t
                       where t.lead_id = l.id and t.status = 'open' and t.due_at <= now()))
          then greatest(1, extract(day from now() - (select min(t.due_at) from tasks t
                                                      where t.lead_id = l.id and t.status = 'open'))::integer)
        when (exists (select 1 from tasks t where t.lead_id = l.id and t.status = 'open')) then 0
        else greatest(0, extract(day from now() - coalesce(l.last_activity, now()))::integer)
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
   from leads l
     left join stages s on s.id = l.stage_id;
