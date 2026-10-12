-- Future of Work Lab: aggregate views the UI reads.
-- All views are security_invoker, so they run with the caller's rights: only
-- service_role can read them, the same as the tables underneath.
-- Every employee-derived measure is null for a group under fow.min_group_size().

create function fow.min_group_size()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

comment on function fow.min_group_size() is
  'Groups with fewer employees than this have their employee-derived measures suppressed (null).';

-- Latest succeeded score per task, then exposure per job. Not read by the UI
-- directly; it keeps unsuppressed headcount so roll-ups include small jobs.
create view fow.job_exposure_base
with (security_invoker = true)
as
with latest_scores as (
  select distinct on (s.task_id)
    s.task_id,
    s.label,
    s.exposure
  from fow.task_exposure_scores s
  join fow.scoring_runs r on r.run_id = s.run_id
  where r.status = 'succeeded'
  order by s.task_id, r.finished_at desc nulls last, r.started_at desc
),
job_scores as (
  select
    jt.dataset_id,
    jt.job_key,
    count(*) as tasks_total,
    count(ls.task_id) as tasks_scored,
    sum(jt.time_share) filter (where ls.task_id is not null) as score_coverage,
    coalesce(sum(jt.time_share) filter (where ls.label = 'automate'), 0) as automate_share,
    coalesce(sum(jt.time_share) filter (where ls.label = 'augment'), 0) as augment_share,
    coalesce(sum(jt.time_share * ls.exposure), 0) as exposure_score
  from fow.job_tasks jt
  left join latest_scores ls on ls.task_id = jt.task_id
  group by jt.dataset_id, jt.job_key
)
select
  dj.dataset_id,
  dj.job_key,
  dj.title,
  dj.function_name,
  dj.family_name,
  dj.onetsoc_code,
  dj.job_profile_id,
  coalesce(dj.headcount, 0) as headcount,
  coalesce(dj.labor_cost_usd, 0) as labor_cost_usd,
  coalesce(js.tasks_total, 0)::integer as tasks_total,
  coalesce(js.tasks_scored, 0)::integer as tasks_scored,
  js.score_coverage,
  case when js.tasks_scored > 0 then js.automate_share end as automate_share,
  case when js.tasks_scored > 0 then js.augment_share end as augment_share,
  case when js.tasks_scored > 0 then js.automate_share + js.augment_share end as exposed_share,
  case when js.tasks_scored > 0 then js.exposure_score end as exposure_score
from fow.dataset_jobs dj
left join job_scores js on js.dataset_id = dj.dataset_id and js.job_key = dj.job_key;

comment on view fow.job_exposure_base is
  'Internal: unsuppressed per-job exposure. Build user-facing views on this; do not read it from the UI.';

-- v_job_exposure ---------------------------------------------------------------

create view fow.v_job_exposure
with (security_invoker = true)
as
select
  b.dataset_id,
  b.job_key,
  b.title,
  b.function_name,
  b.family_name,
  b.onetsoc_code,
  b.headcount < fow.min_group_size() as suppressed,
  case when b.headcount >= fow.min_group_size() then b.headcount end as headcount,
  case when b.headcount >= fow.min_group_size() then b.labor_cost_usd end as labor_cost_usd,
  b.tasks_total,
  b.tasks_scored,
  b.score_coverage,
  b.automate_share,
  b.augment_share,
  b.exposed_share,
  b.exposure_score
from fow.job_exposure_base b;

comment on view fow.v_job_exposure is
  'Per job: share of task time labeled automate or augment (exposed_share = automate_share + augment_share) and exposure_score = sum(time_share x exposure). Exposure is null until the job has scored tasks. Headcount and cost are null under the minimum group size; task-based exposure is not employee data and stays visible.';

-- v_function_exposure ------------------------------------------------------------

create view fow.v_function_exposure
with (security_invoker = true)
as
with rolled as (
  select
    b.dataset_id,
    b.function_name,
    grouping(b.function_name) = 1 as is_total,
    count(*)::integer as jobs,
    count(b.exposed_share)::integer as jobs_scored,
    sum(b.headcount)::integer as headcount,
    sum(b.labor_cost_usd) as labor_cost_usd,
    sum(b.headcount * b.automate_share) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as automate_share_hc,
    sum(b.headcount * b.augment_share) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as augment_share_hc,
    sum(b.headcount * b.exposed_share) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as exposed_share_hc,
    sum(b.headcount * b.exposure_score) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as exposure_score_hc,
    sum(b.labor_cost_usd * b.automate_share) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as automate_share_cost,
    sum(b.labor_cost_usd * b.augment_share) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as augment_share_cost,
    sum(b.labor_cost_usd * b.exposed_share) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as exposed_share_cost,
    sum(b.labor_cost_usd * b.exposure_score) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as exposure_score_cost
  from fow.job_exposure_base b
  group by grouping sets ((b.dataset_id, b.function_name), (b.dataset_id))
)
select
  r.dataset_id,
  r.function_name,
  r.is_total,
  r.jobs,
  r.jobs_scored,
  r.headcount < fow.min_group_size() as suppressed,
  case when r.headcount >= fow.min_group_size() then r.headcount end as headcount,
  case when r.headcount >= fow.min_group_size() then r.labor_cost_usd end as labor_cost_usd,
  case when r.headcount >= fow.min_group_size() then r.automate_share_hc end as automate_share_hc,
  case when r.headcount >= fow.min_group_size() then r.augment_share_hc end as augment_share_hc,
  case when r.headcount >= fow.min_group_size() then r.exposed_share_hc end as exposed_share_hc,
  case when r.headcount >= fow.min_group_size() then r.exposure_score_hc end as exposure_score_hc,
  case when r.headcount >= fow.min_group_size() then r.automate_share_cost end as automate_share_cost,
  case when r.headcount >= fow.min_group_size() then r.augment_share_cost end as augment_share_cost,
  case when r.headcount >= fow.min_group_size() then r.exposed_share_cost end as exposed_share_cost,
  case when r.headcount >= fow.min_group_size() then r.exposure_score_cost end as exposure_score_cost
from rolled r;

comment on view fow.v_function_exposure is
  'Headcount-weighted (_hc) and labor-cost-weighted (_cost) exposure by function. is_total = true is the company row (function_name null). Weights cover jobs with scored tasks only; jobs_scored says how many.';

-- v_exposure_adoption ------------------------------------------------------------

create view fow.v_exposure_adoption
with (security_invoker = true)
as
with latest_snapshot as (
  select es.employee_id, es.job_profile_id
  from public.employee_snapshots es
  where es.snapshot_date = (select max(snapshot_date) from public.employee_snapshots)
),
latest_week as (
  select max(week_start) as week_start from fow.ai_usage_weekly
),
employee_usage as (
  select
    u.employee_id,
    bool_or(t.approved and u.week_start = lw.week_start) as licensed,
    bool_or(t.approved and u.week_start = lw.week_start and u.active_days > 0) as weekly_active,
    bool_or(not t.approved and u.week_start > lw.week_start - 28 and u.active_days > 0) as shadow_user
  from fow.ai_usage_weekly u
  join fow.ai_tools t on t.tool_id = u.tool_id
  cross join latest_week lw
  where u.week_start > lw.week_start - 28
  group by u.employee_id
),
job_adoption as (
  select
    dj.dataset_id,
    dj.job_key,
    count(*) filter (where eu.licensed) as licensed,
    count(*) filter (where eu.weekly_active) as weekly_active,
    count(*) filter (where eu.shadow_user) as shadow_users
  from fow.dataset_jobs dj
  join latest_snapshot ls on ls.job_profile_id = dj.job_profile_id
  left join employee_usage eu on eu.employee_id = ls.employee_id
  group by dj.dataset_id, dj.job_key
),
rolled as (
  select
    b.dataset_id,
    b.function_name,
    b.family_name,
    case
      when grouping(b.function_name) = 1 then 'company'
      when grouping(b.family_name) = 1 then 'function'
      else 'family'
    end as level,
    sum(b.headcount)::integer as headcount,
    sum(b.labor_cost_usd) as labor_cost_usd,
    count(b.exposed_share)::integer as jobs_scored,
    sum(b.headcount * b.exposed_share) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as exposed_share_hc,
    sum(b.labor_cost_usd * b.exposed_share) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as exposed_share_cost,
    sum(b.headcount * b.exposure_score) / nullif(sum(b.headcount) filter (where b.exposed_share is not null), 0) as exposure_score_hc,
    sum(b.labor_cost_usd * b.exposure_score) / nullif(sum(b.labor_cost_usd) filter (where b.exposed_share is not null), 0) as exposure_score_cost,
    count(ja.job_key) > 0 as has_adoption_data,
    sum(ja.licensed)::integer as licensed_employees,
    sum(ja.weekly_active)::integer as weekly_active_users,
    sum(ja.shadow_users)::integer as shadow_ai_users
  from fow.job_exposure_base b
  left join job_adoption ja on ja.dataset_id = b.dataset_id and ja.job_key = b.job_key
  group by grouping sets (
    (b.dataset_id, b.function_name, b.family_name),
    (b.dataset_id, b.function_name),
    (b.dataset_id)
  )
)
select
  r.dataset_id,
  r.level,
  r.function_name,
  r.family_name,
  (select week_start from latest_week) as week_start,
  r.headcount < fow.min_group_size() as suppressed,
  case when r.headcount >= fow.min_group_size() then r.headcount end as headcount,
  case when r.headcount >= fow.min_group_size() then r.labor_cost_usd end as labor_cost_usd,
  r.jobs_scored,
  case when r.headcount >= fow.min_group_size() then r.exposed_share_hc end as exposed_share_hc,
  case when r.headcount >= fow.min_group_size() then r.exposed_share_cost end as exposed_share_cost,
  case when r.headcount >= fow.min_group_size() then r.exposure_score_hc end as exposure_score_hc,
  case when r.headcount >= fow.min_group_size() then r.exposure_score_cost end as exposure_score_cost,
  case when r.headcount >= fow.min_group_size() and r.has_adoption_data then r.licensed_employees end as licensed_employees,
  case when r.headcount >= fow.min_group_size() and r.has_adoption_data then r.weekly_active_users end as weekly_active_users,
  case when r.headcount >= fow.min_group_size() and r.has_adoption_data
    then round(r.licensed_employees::numeric / r.headcount, 4) end as licensed_rate,
  case when r.headcount >= fow.min_group_size() and r.has_adoption_data
    then round(r.weekly_active_users::numeric / r.headcount, 4) end as weekly_active_rate,
  case when r.headcount >= fow.min_group_size() and r.licensed_employees >= fow.min_group_size()
    then round(r.weekly_active_users::numeric / r.licensed_employees, 4) end as weekly_active_rate_licensed,
  case when r.headcount >= fow.min_group_size() and r.has_adoption_data
    then round(r.shadow_ai_users::numeric / r.headcount, 4) end as shadow_ai_rate
from rolled r;

comment on view fow.v_exposure_adoption is
  'Exposure joined to adoption at family, function, and company level (see level). Adoption uses the latest usage week: weekly_active_rate = employees active on an approved tool / headcount; weekly_active_rate_licensed uses licensed employees as the denominator; shadow_ai_rate = employees using an unapproved tool in the last 4 weeks / headcount. Adoption is null for datasets without employee data (uploads).';

-- v_register ---------------------------------------------------------------------

create view fow.v_register
with (security_invoker = true)
as
with current_assessments as (
  select distinct on (ra.use_case_id, ra.framework) ra.*
  from fow.risk_assessments ra
  order by ra.use_case_id, ra.framework, ra.assessed_on desc
),
per_use_case as (
  select
    ca.use_case_id,
    array_agg(ca.framework order by ca.framework) as frameworks,
    (array_agg(ca.tier order by case ca.tier when 'high' then 3 when 'medium' then 2 else 1 end desc))[1] as risk_tier,
    max(ca.assessed_on) as last_assessed_on,
    min(ca.next_review_date) as next_review_date,
    max(ca.bias_audit_date) filter (where ca.framework = 'NYC LL 144') as bias_audit_date,
    bool_or(ca.framework = 'NYC LL 144') as bias_audit_required,
    bool_or(ca.review_state in ('in_review', 'changes_requested')) as any_in_review,
    bool_and(ca.review_state = 'draft') as all_draft
  from current_assessments ca
  group by ca.use_case_id
),
flagged as (
  select
    uc.*,
    t.name as tool_name,
    t.approved as tool_approved,
    p.frameworks,
    p.risk_tier,
    p.last_assessed_on,
    p.next_review_date,
    p.bias_audit_date,
    coalesce(p.next_review_date < current_date, false) as is_overdue,
    coalesce(
      p.bias_audit_required
        and (p.bias_audit_date is null or p.bias_audit_date < current_date - interval '1 year'),
      false
    ) as bias_audit_due,
    p.use_case_id is null or p.all_draft as not_reviewed,
    coalesce(p.any_in_review, false) as in_review
  from fow.ai_use_cases uc
  left join fow.ai_tools t on t.tool_id = uc.tool_id
  left join per_use_case p on p.use_case_id = uc.use_case_id
)
select
  f.use_case_id,
  f.name,
  f.hr_process,
  f.tool_id,
  f.tool_name,
  f.tool_approved,
  f.decision_impact,
  f.owner,
  f.human_in_loop,
  f.status,
  f.risk_tier,
  f.frameworks,
  f.last_assessed_on,
  f.next_review_date,
  f.bias_audit_date,
  f.is_overdue,
  f.bias_audit_due,
  case
    when f.is_overdue then 'Overdue'
    when f.bias_audit_due then 'Bias audit due'
    when f.in_review then 'In review'
    when f.not_reviewed then 'Not reviewed'
    else 'Approved'
  end as review_status
from flagged f;

comment on view fow.v_register is
  'Governance register: one row per use case with its highest current risk tier across frameworks. is_overdue = earliest next_review_date has passed; bias_audit_due = NYC LL 144 applies and the last bias audit is missing or over a year old.';

grant select on fow.job_exposure_base, fow.v_job_exposure, fow.v_function_exposure,
  fow.v_exposure_adoption, fow.v_register to service_role;
revoke execute on function fow.min_group_size() from public, anon, authenticated;
