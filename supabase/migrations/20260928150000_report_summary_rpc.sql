-- التقارير: كل الحسابات جوه القاعدة في نداء واحد بدل ما الصفحة تجيب كل الليدات للمتصفح
-- SECURITY INVOKER (الافتراضي) — الـ RLS بيتطبق زي ما كان في الاستعلامات القديمة
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
with
l as (   -- ليدات الفترة
  select id, stage_id, source_id, lost_reason_id, owner_id, coordinator_id
    from leads
   where created_at between p_from and p_to
),
d as (   -- العمليات اللي تمت في الفترة
  select id, lead_id, net_amount, agent_id, coordinator_id
    from deals
   where status = 'done' and outcome_at between p_from and p_to
),
reached as (   -- مين دخل كل مرحلة في الفترة + ليدات الفترة في مرحلتها الحالية
  select to_stage as stage_id, lead_id
    from activities
   where type = 'stage_change' and to_stage is not null
     and created_at between p_from and p_to
  union
  select stage_id, id from l
),
person as (
  -- السيلز: الليدات اللي هو مسؤول عنها · المنسقة: الليدات اللي اتحولتلها
  select owner_id as pid, count(*) as leads, 0::bigint as deals, 0::numeric as revenue
    from l where owner_id is not null group by owner_id
  union all
  select coordinator_id, count(*), 0, 0
    from l where coordinator_id is not null and coordinator_id is distinct from owner_id
   group by coordinator_id
  union all
  -- العملية تُنسب للسيلز والمنسقة معًا (أساس العمولة)
  select agent_id, 0, count(*), coalesce(sum(net_amount), 0)
    from d where agent_id is not null group by agent_id
  union all
  select coordinator_id, 0, count(*), coalesce(sum(net_amount), 0)
    from d where coordinator_id is not null and coordinator_id is distinct from agent_id
   group by coordinator_id
),
team as (
  select pid, sum(leads) as leads, sum(deals) as deals, sum(revenue) as revenue
    from person group by pid
)
select jsonb_build_object(
  'leads',     (select count(*) from l),
  'deals',     (select count(*) from d),
  'revenue',   (select coalesce(sum(net_amount), 0) from d),
  'collected', (select coalesce(sum(amount), 0) from payments
                 where status = 'active' and paid_at between p_from and p_to),
  'cohort_deals', (select count(distinct dd.lead_id)
                     from deals dd join l on l.id = dd.lead_id
                    where dd.status = 'done'),
  'stage_counts', coalesce((
      select jsonb_object_agg(stage_id, n)
        from (select stage_id, count(*) as n from l where stage_id is not null group by stage_id) x
    ), '{}'::jsonb),
  'reached_counts', coalesce((
      select jsonb_object_agg(stage_id, n)
        from (select stage_id, count(distinct lead_id) as n from reached
               where stage_id is not null group by stage_id) x
    ), '{}'::jsonb),
  'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(s.name_ar, 'غير محدد'), 'count', x.n)
                       order by x.n desc)
        from (select source_id, count(*) as n from l group by source_id) x
        left join lead_sources s on s.id = x.source_id
    ), '[]'::jsonb),
  'by_lost', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(r.name_ar, 'أخرى'), 'count', x.n)
                       order by x.n desc)
        from (select lost_reason_id, count(*) as n from l
               where lost_reason_id is not null group by lost_reason_id) x
        left join lost_reasons r on r.id = x.lost_reason_id
    ), '[]'::jsonb),
  'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.pid, 'name', coalesce(p.full_name, '—'), 'role', ro.code,
               'status', p.status, 'leads', t.leads, 'deals', t.deals, 'revenue', t.revenue)
             order by t.revenue desc, t.deals desc, t.leads desc)
        from team t
        left join profiles p on p.id = t.pid
        left join roles ro on ro.id = p.role_id
    ), '[]'::jsonb)
);
$$;

revoke all on function public.report_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_summary(timestamptz, timestamptz) to authenticated;
