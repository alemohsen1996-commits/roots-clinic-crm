-- عداد الإهمال بقى متحكم فيه بالكامل من إعدادات المرحلة:
--   no_alert = true   → المرحلة من غير عداد خالص (زي مراحل الانتظار)
--   sla_hours         → العداد يبدأ بعد المهلة
--   من غير الاتنين    → العداد يومي من آخر نشاط
--   الفئة تمت/خسارة   → من غير عداد دايمًا
alter table public.stages add column if not exists no_alert boolean not null default false;

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
        when s.category in ('won', 'lost') or s.no_alert then 0
        when s.code = any (array['dead', 'lost', 'done', 'won']) then 0
        when l.snooze_until is not null and l.snooze_until > now() then 0
        when (exists (select 1 from tasks t
                       where t.lead_id = l.id and t.status = 'open' and t.due_at <= now()))
          then greatest(1, extract(day from now() - (select min(t.due_at) from tasks t
                                                      where t.lead_id = l.id and t.status = 'open'))::integer)
        when (exists (select 1 from tasks t where t.lead_id = l.id and t.status = 'open')) then 0
        when s.sla_hours is not null and s.sla_hours > 0 then
          case
            when now() - coalesce(l.last_activity, now()) < make_interval(hours => s.sla_hours) then 0
            else floor(extract(epoch from (now() - l.last_activity - make_interval(hours => s.sla_hours))) / 86400)::integer + 1
          end
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
