-- Independent SQL behind every KPI and chart value on the Overview (milestone 4).
--
-- It reads the base tables (job_tasks, task_exposure_scores, ai_usage_weekly, risk_assessments,
-- employee_snapshots), not the fow views, so it checks the views and the screen code together.
-- Run it in the Supabase SQL editor; expected.json holds its output as of 2026-10-13, and
-- snapshot.json holds the view rows the app reads. tests/overview.test.mjs feeds the snapshot
-- through lib/overview/metrics.mjs and compares with expected.json.
--
-- Output keys -> UI value:
--   kpi.exposure_hc / kpi.exposure_cost            KPI 1, weighting toggle
--   kpi.adoption_rate_licensed, active, licensed   KPI 2
--   kpi.use_cases, high_risk, overdue              KPI 3
--   kpi.redesign_roles, redesign_employees         KPI 4 (job exposure score >= 0.65)
--   kpi.headcount, functions                       page subtitle
--   bars[]                                         "Exposure by function" (shares of task time)
--   quadrant[]                                     "Exposure x adoption" bubbles; x_mid is the company adoption line


with latest as (
  select distinct on (s.task_id) s.task_id, s.label, s.exposure
  from fow.task_exposure_scores s
  join fow.scoring_runs r on r.run_id = s.run_id
  where r.status = 'succeeded'
  order by s.task_id, r.finished_at desc nulls last, r.started_at desc
),
job as (
  select
    dj.job_key, dj.function_name, dj.family_name, dj.job_profile_id,
    coalesce(dj.headcount, 0) as hc,
    coalesce(dj.labor_cost_usd, 0) as cost,
    coalesce(sum(jt.time_share) filter (where l.label = 'automate'), 0) as automate,
    coalesce(sum(jt.time_share) filter (where l.label = 'augment'), 0) as augment,
    sum(jt.time_share * l.exposure) as score
  from fow.dataset_jobs dj
  join fow.job_tasks jt on jt.dataset_id = dj.dataset_id and jt.job_key = dj.job_key
  join latest l on l.task_id = jt.task_id
  where dj.dataset_id = 'builtin'
  group by dj.job_key, dj.function_name, dj.family_name, dj.job_profile_id, dj.headcount, dj.labor_cost_usd
),
fn as (
  select function_name,
    sum(hc) as hc,
    sum(hc * automate) / sum(hc) as automate_hc, sum(hc * augment) / sum(hc) as augment_hc,
    sum(hc * score) / sum(hc) as score_hc,
    sum(cost * automate) / sum(cost) as automate_cost, sum(cost * augment) / sum(cost) as augment_cost,
    sum(cost * score) / sum(cost) as score_cost
  from job group by function_name
),
co as (
  select sum(hc) as hc, count(distinct function_name) as functions,
    sum(hc * score) / sum(hc) as score_hc, sum(cost * score) / sum(cost) as score_cost
  from job
),
snap as (
  select employee_id, job_profile_id from public.employee_snapshots
  where snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
usage as (
  select u.employee_id, bool_or(u.active_days > 0) as active
  from fow.ai_usage_weekly u
  join fow.ai_tools t on t.tool_id = u.tool_id
  where t.approved and u.week_start = (select max(week_start) from fow.ai_usage_weekly)
  group by u.employee_id
),
emp as (
  select s.employee_id, j.function_name, j.family_name, u.employee_id is not null as licensed, coalesce(u.active, false) as active
  from snap s join job j on j.job_profile_id = s.job_profile_id
  left join usage u on u.employee_id = s.employee_id
),
fam as (
  select j.function_name, j.family_name,
    sum(j.hc) as hc,
    sum(j.hc * j.score) / sum(j.hc) as score_hc, sum(j.cost * j.score) / sum(j.cost) as score_cost
  from job j group by j.function_name, j.family_name
),
fam_adopt as (
  select function_name, family_name, count(*) as n, count(*) filter (where active) as active_n
  from emp group by function_name, family_name
),
assess as (
  select distinct on (use_case_id, framework) *
  from fow.risk_assessments order by use_case_id, framework, assessed_on desc
),
uc as (
  select use_case_id,
    max(case tier when 'high' then 3 when 'medium' then 2 else 1 end) as tier_rank,
    min(next_review_date) < current_date as overdue
  from assess group by use_case_id
)
select jsonb_pretty(jsonb_build_object(
  'as_of', current_date,
  'kpi', (select jsonb_build_object(
      'exposure_hc', round(co.score_hc, 6), 'exposure_cost', round(co.score_cost, 6),
      'adoption_rate_licensed', round(count(*) filter (where emp.active)::numeric / nullif(count(*) filter (where emp.licensed), 0), 4),
      'active', count(*) filter (where emp.active), 'licensed', count(*) filter (where emp.licensed),
      'headcount', co.hc, 'functions', co.functions,
      'use_cases', (select count(*) from fow.ai_use_cases),
      'high_risk', (select count(*) from uc where tier_rank = 3),
      'overdue', (select count(*) from uc where overdue),
      'redesign_roles', (select count(*) from job where score >= 0.65),
      'redesign_employees', (select coalesce(sum(hc), 0) from job where score >= 0.65 and hc >= 10))
    from co, emp group by co.score_hc, co.score_cost, co.hc, co.functions),
  'x_mid', (select round(count(*) filter (where active)::numeric / count(*), 4) from emp),
  'bars', (select jsonb_agg(jsonb_build_object(
      'function', function_name, 'headcount', hc,
      'automate_hc', round(automate_hc, 6), 'augment_hc', round(augment_hc, 6),
      'automate_cost', round(automate_cost, 6), 'augment_cost', round(augment_cost, 6),
      'score_hc', round(score_hc, 6), 'score_cost', round(score_cost, 6)) order by function_name)
    from fn where hc >= 10),
  'quadrant', (select jsonb_agg(jsonb_build_object(
      'function', f.function_name, 'family', f.family_name, 'headcount', f.hc,
      'adoption', round(a.active_n::numeric / a.n, 4),
      'score_hc', round(f.score_hc, 6), 'score_cost', round(f.score_cost, 6)) order by f.function_name, f.family_name)
    from fam f join fam_adopt a using (function_name, family_name) where f.hc >= 10)
));
