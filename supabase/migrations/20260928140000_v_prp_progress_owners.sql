-- v_prp_progress: إضافة مسؤولي الديل + phone_norm (أعمدة جديدة في الآخر — الأعمدة القديمة زي ما هي)
-- عشان صفحة البلازما تعمل صفحات وبحث وفلتر "مرضاي" في القاعدة بدل ما تجيب كل الباقات
create or replace view public.v_prp_progress
with (security_invoker = on) as
select pk.id as package_id,
       l.file_no,
       l.full_name,
       l.phone,
       pk.sessions_total,
       count(s.id) filter (where s.status = 'done') as sessions_done,
       min(s.planned_date) filter (where s.status = 'scheduled') as next_session,
       pk.status,
       max(s.actual_date) as last_session_date,
       current_date - max(s.actual_date) as days_since_last,
       l.phone_norm,
       d.agent_id,
       d.coordinator_id,
       ag.full_name as agent_name,
       co.full_name as coordinator_name
  from prp_packages pk
  join leads l on l.id = pk.lead_id
  left join deals d on d.id = pk.deal_id
  left join profiles ag on ag.id = d.agent_id
  left join profiles co on co.id = d.coordinator_id
  left join prp_sessions s on s.package_id = pk.id
 group by pk.id, l.file_no, l.full_name, l.phone, l.phone_norm,
          d.agent_id, d.coordinator_id, ag.full_name, co.full_name;
