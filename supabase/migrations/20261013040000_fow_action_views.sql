-- Future of Work Lab, milestone 6: aggregate views for the action planner.
-- Same rules as the earlier views: security_invoker (only service_role can read), and
-- every employee-derived measure is suppressed or left out for a group under
-- fow.min_group_size(). Reads public tables; creates fow views and adds one fow column.
-- No public object or data is changed.

-- Which prompt produced a recommendation, like scoring_runs.prompt_sha for scores.
alter table fow.action_recommendations add column prompt_sha text;

-- v_function_readiness -----------------------------------------------------------
-- Per function and for the company: AI skills, required-skill coverage, and career
-- preferences of the people in the builtin dataset's jobs (latest snapshot).

create view fow.v_function_readiness
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
people as (
  select ls.employee_id, ls.job_profile_id, dj.function_name
  from latest_snapshot ls
  join fow.dataset_jobs dj on dj.job_profile_id = ls.job_profile_id and dj.dataset_id = 'builtin'
),
ai_skills as (
  select es.employee_id, max(es.proficiency) as top_ai_proficiency
  from public.employee_skills es
  join public.skills s on s.skill_id = es.skill_id
  where s.skill_category = 'AI'
  group by es.employee_id
),
required_skills as (
  select
    p.employee_id,
    count(*) as required_pairs,
    count(*) filter (where coalesce(es.proficiency, 0) >= r.required_proficiency) as met_pairs
  from people p
  join public.job_skill_requirements r on r.job_profile_id = p.job_profile_id and r.importance = 'required'
  left join public.employee_skills es on es.employee_id = p.employee_id and es.skill_id = r.skill_id
  group by p.employee_id
),
per_person as (
  select
    p.function_name,
    coalesce(a.top_ai_proficiency, 0) >= 3 as ai_skilled,
    coalesce(rs.required_pairs, 0) as required_pairs,
    coalesce(rs.met_pairs, 0) as met_pairs,
    cp.employee_id is not null as has_preference,
    coalesce(cp.desired_job_profile_id <> p.job_profile_id, false) as open_to_move,
    coalesce(cp.career_interest = 'AI & Digital Skills', false) as ai_interest
  from people p
  left join ai_skills a on a.employee_id = p.employee_id
  left join required_skills rs on rs.employee_id = p.employee_id
  left join public.career_preferences cp on cp.employee_id = p.employee_id
),
rolled as (
  select
    pp.function_name,
    case when grouping(pp.function_name) = 1 then 'company' else 'function' end as level,
    count(*)::integer as headcount,
    count(*) filter (where pp.ai_skilled)::integer as ai_skilled,
    sum(pp.required_pairs) as required_pairs,
    sum(pp.met_pairs) as met_pairs,
    count(*) filter (where pp.has_preference)::integer as with_preference,
    count(*) filter (where pp.open_to_move)::integer as open_to_move,
    count(*) filter (where pp.ai_interest)::integer as ai_interest
  from per_person pp
  group by grouping sets ((pp.function_name), ())
)
select
  'builtin'::text as dataset_id,
  r.level,
  r.function_name,
  r.headcount < fow.min_group_size() as suppressed,
  case when r.headcount >= fow.min_group_size() then r.headcount end as headcount,
  case when r.headcount >= fow.min_group_size() then round(r.ai_skilled::numeric / r.headcount, 4) end as ai_skilled_rate,
  case when r.headcount >= fow.min_group_size() and r.required_pairs > 0
    then round(r.met_pairs::numeric / r.required_pairs, 4) end as required_skills_met_rate,
  case when r.headcount >= fow.min_group_size() then round(r.with_preference::numeric / r.headcount, 4) end as preference_recorded_rate,
  case when r.headcount >= fow.min_group_size() then round(r.open_to_move::numeric / r.headcount, 4) end as open_to_move_rate,
  case when r.headcount >= fow.min_group_size() then round(r.ai_interest::numeric / r.headcount, 4) end as ai_interest_rate
from rolled r;

comment on view fow.v_function_readiness is
  'Builtin dataset, latest snapshot, per function and company. ai_skilled_rate = share with any AI-category skill at proficiency 3+; required_skills_met_rate = share of (person, required skill) pairs at the required proficiency; open_to_move_rate = share whose career preference names a different job profile; ai_interest_rate = share whose career interest is AI & Digital Skills. Groups under fow.min_group_size() are suppressed.';

-- v_function_skill_gaps ------------------------------------------------------------
-- Per function, skill and importance: how many people hold a job that lists the skill,
-- the share at the required proficiency, and the active courses that teach it.
-- Rows covering fewer than fow.min_group_size() people are left out.

create view fow.v_function_skill_gaps
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
people as (
  select ls.employee_id, ls.job_profile_id, dj.function_name
  from latest_snapshot ls
  join fow.dataset_jobs dj on dj.job_profile_id = ls.job_profile_id and dj.dataset_id = 'builtin'
),
pairs as (
  select
    p.function_name,
    r.skill_id,
    r.importance,
    coalesce(es.proficiency, 0) as proficiency,
    r.required_proficiency
  from people p
  join public.job_skill_requirements r on r.job_profile_id = p.job_profile_id
  left join public.employee_skills es on es.employee_id = p.employee_id and es.skill_id = r.skill_id
),
rolled as (
  select
    pr.function_name,
    pr.skill_id,
    pr.importance,
    count(*)::integer as employees_in_scope,
    count(*) filter (where pr.proficiency >= pr.required_proficiency)::integer as meeting_required,
    avg(pr.proficiency) as avg_proficiency
  from pairs pr
  group by pr.function_name, pr.skill_id, pr.importance
  having count(*) >= fow.min_group_size()
),
courses as (
  select
    c.skill_id,
    jsonb_agg(
      jsonb_build_object('course_code', c.course_code, 'course_name', c.course_name, 'provider', c.provider, 'duration_hours', c.duration_hours)
      order by c.course_code
    ) as courses
  from public.learning_courses c
  where c.active
  group by c.skill_id
)
select
  'builtin'::text as dataset_id,
  r.function_name,
  s.skill_code,
  s.skill_name,
  s.skill_category,
  r.importance,
  r.employees_in_scope,
  round(r.meeting_required::numeric / r.employees_in_scope, 4) as meets_required_rate,
  round(1 - r.meeting_required::numeric / r.employees_in_scope, 4) as gap_rate,
  round(r.avg_proficiency, 2) as avg_proficiency,
  coalesce(jsonb_array_length(c.courses), 0) as course_count,
  coalesce(c.courses, '[]'::jsonb) as courses
from rolled r
join public.skills s on s.skill_id = r.skill_id
left join courses c on c.skill_id = r.skill_id;

comment on view fow.v_function_skill_gaps is
  'Builtin dataset, latest snapshot: per function, skill and importance (required or preferred), the people whose job lists the skill, the share at the required proficiency (missing skill = 0), and active courses for it. Rows under fow.min_group_size() people are omitted.';

-- v_redeployment_paths -------------------------------------------------------------
-- Candidate moves out of each builtin job, from two sources:
--   preference: at least fow.min_group_size() people asked for the move in their
--     career preferences (latest snapshot); smaller groups are not counted.
--   skills: the target job is at least 10 points less exposed and shares two or more
--     specific skills (skills listed by more than a quarter of jobs, such as
--     communication, are too generic to count); top 3 targets per job.
-- Exposure scores are task-based and come from fow.job_exposure_base.

create view fow.v_redeployment_paths
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
jobs as (
  select b.*
  from fow.job_exposure_base b
  where b.dataset_id = 'builtin'
),
job_skills as (
  select j.job_key, r.skill_id
  from jobs j
  join public.job_skill_requirements r on r.job_profile_id = j.job_profile_id
),
specific_skills as (
  select js.job_key, js.skill_id
  from job_skills js
  where js.skill_id in (
    select skill_id from job_skills group by skill_id
    having count(*) <= 0.25 * (select count(distinct job_key) from job_skills)
  )
),
shared as (
  select
    a.job_key as from_job_key,
    b.job_key as to_job_key,
    count(*)::integer as shared_skills,
    array_agg(s.skill_name order by s.skill_name) as shared_skill_names
  from specific_skills a
  join specific_skills b on b.skill_id = a.skill_id and b.job_key <> a.job_key
  join public.skills s on s.skill_id = a.skill_id
  group by a.job_key, b.job_key
),
skill_paths as (
  select from_job_key, to_job_key
  from (
    select
      sh.from_job_key,
      sh.to_job_key,
      row_number() over (partition by sh.from_job_key order by sh.shared_skills desc, t.exposure_score, sh.to_job_key) as rank
    from shared sh
    join jobs f on f.job_key = sh.from_job_key
    join jobs t on t.job_key = sh.to_job_key
    where sh.shared_skills >= 2
      and f.headcount >= fow.min_group_size()
      and t.headcount >= fow.min_group_size()
      and t.exposure_score <= f.exposure_score - 0.10
  ) ranked
  where rank <= 3
),
preference_paths as (
  select src.job_key as from_job_key, dst.job_key as to_job_key, count(*)::integer as interested_employees
  from public.career_preferences cp
  join latest_snapshot ls on ls.employee_id = cp.employee_id
  join jobs src on src.job_profile_id = ls.job_profile_id
  join jobs dst on dst.job_profile_id = cp.desired_job_profile_id
  where cp.desired_job_profile_id <> ls.job_profile_id
  group by src.job_key, dst.job_key
  having count(*) >= fow.min_group_size()
),
paths as (
  select
    coalesce(pp.from_job_key, sp.from_job_key) as from_job_key,
    coalesce(pp.to_job_key, sp.to_job_key) as to_job_key,
    case
      when pp.from_job_key is not null and sp.from_job_key is not null then 'preference and skills'
      when pp.from_job_key is not null then 'preference'
      else 'skills'
    end as basis,
    pp.interested_employees
  from preference_paths pp
  full join skill_paths sp on sp.from_job_key = pp.from_job_key and sp.to_job_key = pp.to_job_key
)
select
  'builtin'::text as dataset_id,
  p.from_job_key,
  f.title as from_title,
  f.function_name as from_function,
  f.family_name as from_family,
  p.to_job_key,
  t.title as to_title,
  t.function_name as to_function,
  t.family_name as to_family,
  p.basis,
  coalesce(sh.shared_skills, 0) as shared_skills,
  coalesce(sh.shared_skill_names, '{}') as shared_skill_names,
  p.interested_employees,
  case when f.headcount >= fow.min_group_size() then round(p.interested_employees::numeric / f.headcount, 4) end as share_of_from_job,
  f.exposure_score as from_exposure_score,
  t.exposure_score as to_exposure_score,
  t.exposure_score - f.exposure_score as exposure_change
from paths p
join jobs f on f.job_key = p.from_job_key
join jobs t on t.job_key = p.to_job_key
left join shared sh on sh.from_job_key = p.from_job_key and sh.to_job_key = p.to_job_key;

comment on view fow.v_redeployment_paths is
  'Builtin dataset: candidate job-to-job moves. basis = preference (at least fow.min_group_size() people asked for it; interested_employees counts them) and/or skills (target is 10+ points less exposed and shares 2+ specific skills; top 3 per job). exposure_change < 0 = less exposed work.';

-- v_course_catalog -----------------------------------------------------------------
-- Active learning courses and the skill each one teaches. Not employee data.

create view fow.v_course_catalog
with (security_invoker = true)
as
select
  c.course_code,
  c.course_name,
  c.provider,
  c.duration_hours,
  s.skill_code,
  s.skill_name,
  s.skill_category
from public.learning_courses c
join public.skills s on s.skill_id = c.skill_id
where c.active;

comment on view fow.v_course_catalog is 'Active learning courses with the skill each teaches.';

grant select on fow.v_function_readiness, fow.v_function_skill_gaps, fow.v_redeployment_paths,
  fow.v_course_catalog to service_role;
