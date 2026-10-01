-- ساعات مختلفة لكل يوم في الفرع
-- day_hours: {"<dow>": {"start":"18:00","end":"20:20"}} — dow: 0=الأحد .. 6=السبت
-- اليوم اللي مش موجود فيه → يرجع لـ start_time/end_time العامة
alter table public.branch_schedules
  add column if not exists day_hours jsonb not null default '{}'::jsonb;

create or replace function public.available_slots(p_branch_id bigint, p_date date)
returns table(slot time without time zone)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_start time; v_end time; v_min int; v_days int[]; v_hours jsonb;
  v_dow  int := extract(dow from p_date)::int;   -- 0=الأحد .. 6=السبت
  v_total int;
begin
  select start_time, end_time, slot_minutes, work_days, day_hours
    into v_start, v_end, v_min, v_days, v_hours
  from branch_schedules where branch_id = p_branch_id;

  if v_start is null then return; end if;               -- الفرع غير مُعدّ
  if not (v_dow = any(coalesce(v_days,'{}'))) then return; end if;  -- اليوم إجازة

  -- ساعات خاصة باليوم ده لو متحددة
  if v_hours ? v_dow::text then
    v_start := coalesce((v_hours -> v_dow::text ->> 'start')::time, v_start);
    v_end   := coalesce((v_hours -> v_dow::text ->> 'end')::time,   v_end);
  end if;

  v_total := (extract(epoch from (v_end - v_start)) / 60)::int;
  if v_total < v_min then return; end if;

  return query
  with gen as (
    select (v_start + (n || ' minutes')::interval)::time as t
    from generate_series(0, v_total - v_min, v_min) as n
  )
  select g.t
  from gen g
  where not exists (
    select 1 from appointments a
    where a.branch_id = p_branch_id
      and a.appt_date = p_date
      and a.appt_time = g.t
      and a.status in ('booked','attended')
  )
  order by g.t;
end $function$;

-- جدة: السبت والأحد 6:00–8:20 م · الاثنين–الخميس 5:00–8:00 م
update public.branch_schedules
   set day_hours = '{"6":{"start":"18:00","end":"20:20"},"0":{"start":"18:00","end":"20:20"},
                     "1":{"start":"17:00","end":"20:00"},"2":{"start":"17:00","end":"20:00"},
                     "3":{"start":"17:00","end":"20:00"},"4":{"start":"17:00","end":"20:00"}}'::jsonb,
       start_time = '17:00', end_time = '20:00',
       updated_at = now()
 where branch_id = 2;
