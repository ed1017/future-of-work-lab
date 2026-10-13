-- Future of Work Lab, milestone 5: aggregate views for the Adoption screen.
-- Same rules as the milestone 2 views: security_invoker (only service_role can read),
-- and every employee-derived measure is suppressed for a group under fow.min_group_size().
-- Creates new fow views only; no table, public object, or data is changed.

-- v_adoption_manager -------------------------------------------------------------
-- One row per team (the direct reports of one manager) with at least
-- fow.min_group_size() people. No manager identity is exposed: teams are numbered
-- within their function by size. Smaller teams are left out of the view entirely.

create view fow.v_adoption_manager
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id, es.manager_employee_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
    and es.manager_employee_id is not null
),
latest_week as (
  select max(week_start) as week_start from fow.ai_usage_weekly
),
employee_usage as (
  select
    u.employee_id,
    bool_or(t.approved) as licensed,
    bool_or(t.approved and u.active_days > 0) as weekly_active
  from fow.ai_usage_weekly u
  join fow.ai_tools t on t.tool_id = u.tool_id
  where u.week_start = (select week_start from latest_week)
  group by u.employee_id
),
teams as (
  select
    ls.manager_employee_id,
    mode() within group (order by dj.function_name) as function_name,
    count(*)::integer as headcount,
    count(*) filter (where eu.licensed)::integer as licensed_employees,
    count(*) filter (where eu.weekly_active)::integer as weekly_active_users
  from latest_snapshot ls
  join fow.dataset_jobs dj on dj.job_profile_id = ls.job_profile_id and dj.dataset_id = 'builtin'
  left join employee_usage eu on eu.employee_id = ls.employee_id
  group by ls.manager_employee_id
  having count(*) >= fow.min_group_size()
)
select
  t.function_name,
  row_number() over (partition by t.function_name order by t.headcount desc, t.manager_employee_id)::integer as team_number,
  (select week_start from latest_week) as week_start,
  t.headcount,
  t.licensed_employees,
  t.weekly_active_users,
  round(t.licensed_employees::numeric / t.headcount, 4) as licensed_rate,
  round(t.weekly_active_users::numeric / t.headcount, 4) as weekly_active_rate
from teams t;

comment on view fow.v_adoption_manager is
  'Weekly active-user rate per manager team (builtin dataset, latest usage week). Teams under fow.min_group_size() people are omitted; the manager is not identified, only a team_number within the function.';

-- v_tool_mix ---------------------------------------------------------------------
-- Latest usage week per AI tool: who is active, plus the licence count.

create view fow.v_tool_mix
with (security_invoker = true)
as
with latest_week as (
  select max(week_start) as week_start from fow.ai_usage_weekly
),
per_tool as (
  select
    t.tool_id,
    t.name,
    t.category,
    t.approved,
    t.licenses,
    count(distinct u.employee_id) filter (where u.active_days > 0)::integer as weekly_active_users,
    coalesce(sum(u.sessions), 0)::integer as sessions
  from fow.ai_tools t
  left join fow.ai_usage_weekly u
    on u.tool_id = t.tool_id and u.week_start = (select week_start from latest_week)
  group by t.tool_id, t.name, t.category, t.approved, t.licenses
)
select
  p.tool_id,
  p.name,
  p.category,
  p.approved,
  p.licenses,
  (select week_start from latest_week) as week_start,
  p.weekly_active_users < fow.min_group_size() as suppressed,
  case when p.weekly_active_users >= fow.min_group_size() then p.weekly_active_users end as weekly_active_users,
  case when p.weekly_active_users >= fow.min_group_size() then p.sessions end as sessions
from per_tool p;

comment on view fow.v_tool_mix is
  'AI tools in the latest usage week. approved = false is shadow AI. Active users and sessions are suppressed (null) when fewer than fow.min_group_size() people were active.';

-- v_pulse_sentiment --------------------------------------------------------------
-- Favorable share per pulse question and wave, for the company and each function.
-- Reverse-scored questions are flipped so favorable always means a good outcome.

create view fow.v_pulse_sentiment
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
responses as (
  select
    q.question_code,
    q.question_text,
    p.response_date,
    dj.function_name,
    case when q.reverse_scored then 6 - p.score else p.score end as adjusted_score
  from fow.ai_pulse_responses p
  join fow.ai_pulse_questions q on q.question_code = p.question_code
  join latest_snapshot ls on ls.employee_id = p.employee_id
  join fow.dataset_jobs dj on dj.job_profile_id = ls.job_profile_id and dj.dataset_id = 'builtin'
),
rolled as (
  select
    r.question_code,
    min(r.question_text) as question_text,
    r.response_date,
    r.function_name,
    case when grouping(r.function_name) = 1 then 'company' else 'function' end as level,
    count(*)::integer as respondents,
    count(*) filter (where r.adjusted_score >= 4)::integer as favorable,
    avg(r.adjusted_score) as mean_score
  from responses r
  group by grouping sets (
    (r.question_code, r.response_date, r.function_name),
    (r.question_code, r.response_date)
  )
)
select
  r.level,
  r.function_name,
  r.question_code,
  r.question_text,
  r.response_date,
  r.respondents < fow.min_group_size() as suppressed,
  case when r.respondents >= fow.min_group_size() then r.respondents end as respondents,
  case when r.respondents >= fow.min_group_size() then round(r.favorable::numeric / r.respondents, 4) end as favorable_rate,
  case when r.respondents >= fow.min_group_size() then round(r.mean_score, 2) end as mean_score
from rolled r;

comment on view fow.v_pulse_sentiment is
  'AI pulse survey: favorable share (score 4-5 after flipping reverse-scored questions) per question and wave, at company and function level. Groups under fow.min_group_size() respondents are suppressed.';

grant select on fow.v_adoption_manager, fow.v_tool_mix, fow.v_pulse_sentiment to service_role;
