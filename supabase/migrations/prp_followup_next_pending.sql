-- قايمة المتابعة مبنية على "الجلسة الجاية المستحقة" (أقل رقم جلسة لسه ما اتعملتش):
-- لو ماحضرهاش أو مالهاش ميعاد → محتاج تواصل. لو ليها ميعاد جاي → خارج القايمة.
create or replace view public.v_prp_followup
with (security_invoker = true) as
with base as (
  select pk.id as package_id, pk.sessions_total, pk.created_at, pk.lead_id, pk.deal_id,
    (select max(s.actual_date) from public.prp_sessions s
      where s.package_id = pk.id and s.status = 'done') as last_done,
    (select count(*) from public.prp_sessions s
      where s.package_id = pk.id and s.status = 'done') as sessions_done,
    np.session_no as next_session_no, np.status as next_status, np.planned_date as next_planned,
    exists (select 1 from public.prp_sessions s where s.package_id = pk.id and s.status = 'scheduled'
            and s.planned_date < (now() at time zone 'Asia/Riyadh')::date) as has_unrecorded
  from public.prp_packages pk
  left join lateral (
    select s.session_no, s.status, s.planned_date from public.prp_sessions s
    where s.package_id = pk.id and s.status in ('scheduled', 'missed')
    order by s.session_no limit 1
  ) np on true
  where pk.status = 'active'
),
calc as (
  select b.*,
    (select count(*) from public.prp_session_events e
      where e.package_id = b.package_id and e.event = 'missed'
        and e.created_at > coalesce((select max(e2.created_at) from public.prp_session_events e2
                                     where e2.package_id = b.package_id and e2.event = 'done'),
                                    '-infinity'::timestamptz)) as misses_in_row,
    (select max(e.event_date) from public.prp_session_events e
      where e.package_id = b.package_id and e.event = 'missed') as last_missed,
    ((now() at time zone 'Asia/Riyadh')::date
       - coalesce(b.last_done, (b.created_at at time zone 'Asia/Riyadh')::date)) as days_idle,
    f.outcome as last_outcome, f.created_at as last_contact_at, fp.full_name as last_contact_by
  from base b
  left join lateral (
    select pf.outcome, pf.created_at, pf.created_by from public.prp_followups pf
    where pf.package_id = b.package_id order by pf.created_at desc limit 1
  ) f on true
  left join public.profiles fp on fp.id = f.created_by
)
select c.package_id, c.sessions_total, c.sessions_done, c.next_session_no,
       c.last_done, c.last_missed, c.misses_in_row, c.days_idle,
       case when c.misses_in_row >= 2      then 'missed_twice'
            when c.days_idle > 45          then 'stale'
            when c.next_status = 'missed'  then 'missed'
            else 'unbooked' end as reason,
       c.last_outcome, c.last_contact_at, c.last_contact_by,
       l.full_name, l.phone, l.file_no, b.name as branch_name,
       d.coordinator_id, d.agent_id, co.full_name as coordinator_name
from calc c
join public.leads l on l.id = c.lead_id
left join public.branches b on b.id = l.branch_id
left join public.deals d on d.id = c.deal_id
left join public.profiles co on co.id = d.coordinator_id
where not c.has_unrecorded
  and c.next_session_no is not null
  and (c.next_status = 'missed' or c.next_planned is null)
  and (c.last_contact_at is null or c.last_contact_at < now() - case c.last_outcome
        when 'wa_sent'        then interval '2 days'
        when 'no_answer'      then interval '3 days'
        when 'will_book'      then interval '3 days'
        when 'not_interested' then interval '14 days'
        else interval '0' end);

revoke all on public.v_prp_followup from anon;
grant select on public.v_prp_followup to authenticated;
