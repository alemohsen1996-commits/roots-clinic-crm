-- ===================== البلازما: تسجيل الحضور + المتابعة + الأرقام الشهرية =====================
-- (الـ View بتاع قايمة المتابعة اتعدّل بعدها في prp_followup_next_pending.sql)

-- 1) تواريخ اكتمال/انقطاع الباقة (للأرقام الشهرية)
alter table public.prp_packages
  add column if not exists completed_at timestamptz,
  add column if not exists dropped_at   timestamptz;

create or replace function public.prp_package_status_dates()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then now() end;
    new.dropped_at   := case when new.status = 'dropped'   then now() end;
  end if;
  return new;
end $$;

drop trigger if exists trg_prp_package_status_dates on public.prp_packages;
create trigger trg_prp_package_status_dates
  before update of status on public.prp_packages
  for each row execute function public.prp_package_status_dates();

-- 2) سجل الحضور/الغياب — "لم يحضر" بيتمسح من الجلسة لما تتجدول تاني، فالسجل هو المرجع
create table if not exists public.prp_session_events (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references public.prp_sessions(id) on delete cascade,
  package_id  bigint not null references public.prp_packages(id) on delete cascade,
  event       text   not null check (event in ('done', 'missed')),
  event_date  date   not null,
  created_by  uuid   references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists prp_session_events_pkg_idx  on public.prp_session_events(package_id, event_date);
create index if not exists prp_session_events_date_idx on public.prp_session_events(event_date);

alter table public.prp_session_events enable row level security;
drop policy if exists "قراءة سجل جلسات البلازما" on public.prp_session_events;
create policy "قراءة سجل جلسات البلازما" on public.prp_session_events for select to authenticated
using (exists (select 1 from public.prp_packages pk where pk.id = prp_session_events.package_id));

create or replace function public.prp_log_session_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status and new.status in ('done', 'missed') then
    insert into public.prp_session_events(session_id, package_id, event, event_date, created_by)
    values (new.id, new.package_id, new.status,
            case when new.status = 'done'
                 then coalesce(new.actual_date, (now() at time zone 'Asia/Riyadh')::date)
                 else least(coalesce(new.planned_date, (now() at time zone 'Asia/Riyadh')::date),
                            (now() at time zone 'Asia/Riyadh')::date) end,
            auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_prp_log_session_event on public.prp_sessions;
create trigger trg_prp_log_session_event
  after update of status on public.prp_sessions
  for each row execute function public.prp_log_session_event();

-- 3) سجل المتابعة (التواصل مع المرضى المنقطعين)
create table if not exists public.prp_followups (
  id          bigint generated always as identity primary key,
  package_id  bigint not null references public.prp_packages(id) on delete cascade,
  outcome     text   not null check (outcome in ('wa_sent', 'will_book', 'no_answer', 'not_interested')),
  note        text,
  created_by  uuid   references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists prp_followups_pkg_idx on public.prp_followups(package_id, created_at desc);

alter table public.prp_followups enable row level security;
drop policy if exists "قراءة متابعات البلازما" on public.prp_followups;
create policy "قراءة متابعات البلازما" on public.prp_followups for select to authenticated
using (exists (select 1 from public.prp_packages pk where pk.id = prp_followups.package_id));
drop policy if exists "تسجيل متابعات البلازما" on public.prp_followups;
create policy "تسجيل متابعات البلازما" on public.prp_followups for insert to authenticated
with check (
  created_by = (select auth.uid())
  and ((select is_manager()) or (select current_role_code()) = 'prp_officer'
       or exists (select 1 from public.prp_packages pk join public.deals d on d.id = pk.deal_id
                  where pk.id = prp_followups.package_id and d.coordinator_id = (select auth.uid())))
);

-- 4) جلسات فات ميعادها (أو النهارده) ولسه ما اتسجلش حضور/غياب
create or replace view public.v_prp_unrecorded
with (security_invoker = true) as
select s.id as session_id, s.package_id, s.session_no, s.planned_date,
       pk.sessions_total, l.full_name, l.phone, l.file_no,
       d.coordinator_id, d.agent_id, co.full_name as coordinator_name,
       ((now() at time zone 'Asia/Riyadh')::date - s.planned_date) as days_late
from public.prp_sessions s
join public.prp_packages pk on pk.id = s.package_id and pk.status = 'active'
join public.leads l on l.id = pk.lead_id
left join public.deals d on d.id = pk.deal_id
left join public.profiles co on co.id = d.coordinator_id
where s.status = 'scheduled'
  and s.planned_date <= (now() at time zone 'Asia/Riyadh')::date;

revoke all on public.v_prp_unrecorded from anon;
grant select on public.v_prp_unrecorded to authenticated;

-- 5) حجز جلسة لمريض في المتابعة: أول جلسة مش متممة تاخد الميعاد الجديد
create or replace function public.prp_book_next_session(p_package_id bigint, p_date date)
returns bigint language plpgsql security invoker set search_path to 'public' as $$
declare v_id bigint;
begin
  if p_date is null or p_date < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'اختر تاريخ النهارده أو بعده' using errcode = 'P0001';
  end if;
  select s.id into v_id from public.prp_sessions s
  where s.package_id = p_package_id and s.status in ('scheduled', 'missed')
  order by s.session_no limit 1;
  if v_id is null then
    raise exception 'مفيش جلسات متبقية في الباقة' using errcode = 'P0001';
  end if;
  update public.prp_sessions set status = 'scheduled', planned_date = p_date where id = v_id;
  if not found then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return v_id;
end $$;

revoke all on function public.prp_book_next_session(bigint, date) from public, anon;
grant execute on function public.prp_book_next_session(bigint, date) to authenticated;

-- 6) أرقام البلازما لشهر (للصفحة والداشبورد). p_user: أرقام موظف معيّن (جلسات عملها/غياب سجّله)
create or replace function public.prp_month_stats(p_month date default null, p_user uuid default null)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with m as (
    select date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Riyadh')::date))::date as d1
  ), r as (select d1, (d1 + interval '1 month')::date as d2 from m),
  done as (
    select s.* from public.prp_sessions s, r
    where s.status = 'done' and s.actual_date >= r.d1 and s.actual_date < r.d2
      and (p_user is null or s.performed_by = p_user)
  ),
  missed as (
    select e.* from public.prp_session_events e, r
    where e.event = 'missed' and e.event_date >= r.d1 and e.event_date < r.d2
      and (p_user is null or e.created_by = p_user)
  ),
  planned as (
    select s.id from public.prp_sessions s, r
    where (s.planned_date >= r.d1 and s.planned_date < r.d2)
       or (s.status = 'done' and s.actual_date >= r.d1 and s.actual_date < r.d2)
  ),
  fu as (
    select pf.package_id, min(pf.created_at) as first_at from public.prp_followups pf, r
    where pf.created_at >= r.d1 and pf.created_at < r.d2
      and (p_user is null or pf.created_by = p_user)
    group by pf.package_id
  )
  select jsonb_build_object(
    'month',            (select d1 from m),
    'sessions_done',    (select count(*) from done),
    'sessions_missed',  (select count(*) from missed),
    'sessions_planned', (select count(*) from planned),
    'attendance_pct',   (select case when (select count(*) from done) + (select count(*) from missed) = 0 then null
                          else round(100.0 * (select count(*) from done)
                               / ((select count(*) from done) + (select count(*) from missed))) end),
    'pkgs_opened',      (select count(*) from public.prp_packages pk, r where pk.created_at >= r.d1 and pk.created_at < r.d2),
    'pkgs_completed',   (select count(*) from public.prp_packages pk, r where pk.completed_at >= r.d1 and pk.completed_at < r.d2),
    'pkgs_dropped',     (select count(*) from public.prp_packages pk, r where pk.dropped_at >= r.d1 and pk.dropped_at < r.d2),
    'followups',        (select count(*) from fu),
    'returned',         (select count(distinct fu.package_id) from fu
                          join public.prp_sessions s on s.package_id = fu.package_id
                          where s.status = 'done' and s.actual_date >= (fu.first_at at time zone 'Asia/Riyadh')::date),
    'by_performer',     coalesce((select jsonb_agg(x order by x.n desc) from (
                           select p.id as user_id, p.full_name, count(*) as n
                           from done join public.profiles p on p.id = done.performed_by
                           group by p.id, p.full_name) x), '[]'::jsonb)
  );
$$;

revoke all on function public.prp_month_stats(date, uuid) from public, anon;
grant execute on function public.prp_month_stats(date, uuid) to authenticated;
