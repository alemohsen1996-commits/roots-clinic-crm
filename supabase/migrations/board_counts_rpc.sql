-- عدّ الليدات لكل أعمدة البورد في استعلام واحد (بدل استعلام count لكل عمود)
-- SECURITY INVOKER: الـ RLS بيتطبق زي ما هو، فالعدد = نفس اللي الموظف يشوفه
create or replace function public.board_counts(
  p_stage_ids       integer[],
  p_archived        boolean     default false,
  p_source          integer     default null,
  p_owner           uuid        default null,
  p_coordinator     uuid        default null,
  p_branch          bigint      default null,
  p_interest        text        default null,
  p_created_from    timestamptz default null,
  p_created_to      timestamptz default null,
  p_activity_from   timestamptz default null,
  p_activity_before timestamptz default null,
  p_paused          boolean     default false,
  p_no_owner        boolean     default false,
  p_snoozed_after   timestamptz default null
)
returns table(stage_id integer, n bigint)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select l.stage_id, count(*)::bigint
  from public.leads l
  where l.stage_id = any(p_stage_ids)
    and (case when p_archived then l.archived_at is not null else l.archived_at is null end)
    and (p_source        is null or l.source_id = p_source)
    and (p_owner         is null or l.owner_id = p_owner)
    and (p_coordinator   is null or l.coordinator_id = p_coordinator)
    and (p_branch        is null or l.branch_id = p_branch)
    and (p_interest      is null or l.procedure_interest = p_interest)
    and (p_created_from  is null or l.created_at >= p_created_from)
    and (p_created_to    is null or l.created_at <= p_created_to)
    and (p_activity_from is null or l.last_activity >= p_activity_from)
    and (p_activity_before is null or l.last_activity < p_activity_before)
    and (not p_paused    or l.follow_paused)
    and (not p_no_owner  or l.owner_id is null)
    and (p_snoozed_after is null or l.snooze_until > p_snoozed_after)
  group by l.stage_id
$$;

revoke execute on function public.board_counts from public, anon;
grant  execute on function public.board_counts to authenticated;
