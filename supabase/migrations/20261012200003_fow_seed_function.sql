-- Future of Work Lab: reproducible seed for the builtin dataset and the
-- synthetic adoption, pulse, and governance data.
--
-- Run with: select fow.seed_builtin();   (or npm run seed)
-- Every random draw comes from an md5 of the seed and a stable key such as
-- employee id + tool + week (fow.seeded_hash, fow.hash_unit). The same seed and the same
-- public company data always give the same rows, whatever the row order.
-- Reads public tables; writes fow tables only. Safe to re-run: it replaces
-- synthetic usage and pulse rows and upserts the seeded tools, questions,
-- use cases, and builtin jobs. Use cases added by an admin are left alone.

-- The three helpers below have no SET search_path on purpose: that keeps them
-- inlinable, which halves the seed run time. They call only built-ins.

create function fow.seeded_hash(p_seed integer, p_key text)
returns text
language sql
immutable
parallel safe
as $$ select md5(p_seed::text || ':' || p_key) $$;

comment on function fow.seeded_hash(integer, text) is
  'md5 of a seed and a key. Use fow.hash_unit to turn it into up to three uniform draws.';

create function fow.hash_unit(p_hash text, p_part integer default 0)
returns double precision
language sql
immutable
parallel safe
as $$
  select ('x' || substr(p_hash, 1 + 10 * p_part, 10))::bit(40)::bigint
    / 1099511627776.0::double precision
$$;

comment on function fow.hash_unit(text, integer) is
  'Uniform draw in [0, 1) from 40 bits of an md5 hash; p_part 0, 1, or 2 gives independent draws.';

create function fow.seeded_unit(p_seed integer, p_key text)
returns double precision
language sql
immutable
parallel safe
as $$ select fow.hash_unit(fow.seeded_hash(p_seed, p_key), 0) $$;

comment on function fow.seeded_unit(integer, text) is
  'Deterministic uniform draw in [0, 1) from a seed and a key.';

create function fow.seed_builtin(p_seed integer default 20261012)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot date;
  v_last_week date;
  v_company text;
  v_result jsonb;
begin
  select max(snapshot_date) into v_snapshot from public.employee_snapshots;
  select company_name into v_company from public.company_profile limit 1;
  -- Last full Monday-to-Sunday week before the snapshot date.
  v_last_week := date_trunc('week', v_snapshot)::date - 7;

  -- Builtin dataset and its job architecture ---------------------------------

  insert into fow.datasets (dataset_id, name, source, created_by)
  values ('builtin', coalesce(v_company, 'Builtin company'), 'builtin', 'seed')
  on conflict (dataset_id) do update set name = excluded.name;

  insert into fow.dataset_jobs (
    dataset_id, job_key, title, function_name, family_name, onetsoc_code,
    headcount, labor_cost_usd, job_profile_id
  )
  select
    'builtin',
    jp.job_profile_code,
    jp.job_profile_name,
    jf.function_name,
    fam.family_name,
    m.onetsoc_code,
    coalesce(hc.headcount, 0),
    coalesce(hc.labor_cost_usd, 0),
    jp.job_profile_id
  from public.job_profiles jp
  join public.job_families fam on fam.job_family_id = jp.job_family_id
  join public.job_functions jf on jf.job_function_id = fam.job_function_id
  left join public.job_onet_mapping m on m.job_profile_id = jp.job_profile_id
  left join (
    select
      es.job_profile_id,
      count(*)::integer as headcount,
      round(sum(es.total_labor_cost_usd), 2) as labor_cost_usd
    from public.employee_snapshots es
    where es.snapshot_date = v_snapshot
    group by es.job_profile_id
  ) hc on hc.job_profile_id = jp.job_profile_id
  on conflict (dataset_id, job_key) do update set
    title = excluded.title,
    function_name = excluded.function_name,
    family_name = excluded.family_name,
    onetsoc_code = excluded.onetsoc_code,
    headcount = excluded.headcount,
    labor_cost_usd = excluded.labor_cost_usd,
    job_profile_id = excluded.job_profile_id;

  delete from fow.dataset_jobs dj
  where dj.dataset_id = 'builtin'
    and not exists (
      select 1 from public.job_profiles jp where jp.job_profile_code = dj.job_key
    );

  -- Tool catalog and pulse questions -----------------------------------------

  insert into fow.ai_tools (tool_id, name, category, approved)
  values
    ('workspace-assistant', 'Workspace Assistant', 'Productivity suite', true),
    ('enterprise-chat', 'Enterprise Chat', 'General assistant', true),
    ('code-assistant', 'Code Assistant', 'Software development', true),
    ('meeting-notes', 'Meeting Notes AI', 'Meetings', true),
    ('recruiting-copilot', 'Recruiting Copilot', 'Recruiting', true),
    ('analytics-copilot', 'Analytics Copilot', 'Analytics', true),
    ('service-desk-agent', 'Service Desk Agent', 'Customer service', true),
    ('public-chatbot', 'Public chatbot (personal account)', 'Unsanctioned', false)
  on conflict (tool_id) do update set
    name = excluded.name,
    category = excluded.category,
    approved = excluded.approved;

  insert into fow.ai_pulse_questions (question_code, question_text, reverse_scored)
  values
    ('ai_helps_work', 'AI tools help me get my work done faster.', false),
    ('ai_trust_output', 'I trust the output of the AI tools I use, after I check it.', false),
    ('ai_training', 'I have had enough training to use AI tools well.', false),
    ('ai_policy_clear', 'I know which AI tools I am allowed to use, and for what.', false),
    ('ai_manager_support', 'My manager encourages me to try AI tools in my work.', false),
    ('ai_job_worry', 'I worry AI will change my job in ways I do not want.', true)
  on conflict (question_code) do update set
    question_text = excluded.question_text,
    reverse_scored = excluded.reverse_scored;

  -- Employees in the latest snapshot, with seeded licensing and user flags ----
  -- license_p: chance an employee has an AI seat; adopt_p: chance a licensed
  -- employee is a regular user. Tuned per function so the quadrant has spread.

  drop table if exists pg_temp.fow_seed_employees;
  create temporary table fow_seed_employees on commit drop as
  with fn_profile (function_name, license_p, adopt_p) as (
    values
      ('Data & AI', 0.95, 0.80),
      ('Engineering', 0.95, 0.75),
      ('Corporate Technology', 0.90, 0.70),
      ('Product', 0.90, 0.65),
      ('Marketing', 0.80, 0.60),
      ('Strategy & Corporate Development', 0.80, 0.55),
      ('Consulting', 0.85, 0.55),
      ('Sales', 0.75, 0.45),
      ('Corporate Communications', 0.70, 0.50),
      ('Human Resources', 0.75, 0.40),
      ('Finance', 0.65, 0.35),
      ('Operations', 0.60, 0.35),
      ('Procurement', 0.55, 0.30),
      ('Customer Success', 0.60, 0.25),
      ('Legal', 0.50, 0.25)
  )
  select
    es.employee_id,
    jf.function_name,
    fam.family_name,
    coalesce(fp.adopt_p, 0.45) as adopt_p,
    fow.seeded_unit(p_seed, 'license:' || es.employee_id) < coalesce(fp.license_p, 0.70) as licensed,
    fow.seeded_unit(p_seed, 'user:' || es.employee_id) < coalesce(fp.adopt_p, 0.45) as regular_user
  from public.employee_snapshots es
  join public.job_profiles jp on jp.job_profile_id = es.job_profile_id
  join public.job_families fam on fam.job_family_id = jp.job_family_id
  join public.job_functions jf on jf.job_function_id = fam.job_function_id
  left join fn_profile fp on fp.function_name = jf.function_name
  where es.snapshot_date = v_snapshot;

  -- Weekly usage: 12 weeks ending v_last_week --------------------------------

  delete from fow.ai_usage_weekly where true;

  insert into fow.ai_usage_weekly (employee_id, tool_id, week_start, active_days, sessions)
  with seats as (
    select e.employee_id, e.regular_user, t.tool_id, t.mult
    from pg_temp.fow_seed_employees e
    cross join lateral (
      values
        ('workspace-assistant', 1.0::float8, 1.0::float8),
        ('enterprise-chat', 0.55, 0.9),
        ('code-assistant',
          case when e.function_name in ('Engineering', 'Data & AI', 'Corporate Technology') then 0.9 else 0 end,
          1.05),
        ('meeting-notes', 0.3, 0.7),
        ('recruiting-copilot', case when e.family_name = 'Talent Acquisition' then 1.0 else 0 end, 1.0),
        ('analytics-copilot',
          case
            when e.family_name = 'People Analytics' then 0.8
            when e.function_name in ('Data & AI', 'Finance') then 0.6
            when e.function_name = 'Strategy & Corporate Development' then 0.5
            else 0.05
          end,
          0.8),
        ('service-desk-agent',
          case when e.function_name = 'Customer Success' or e.family_name = 'Client Operations' then 0.9 else 0 end,
          1.0)
    ) as t (tool_id, assign_p, mult)
    where e.licensed
      and fow.seeded_unit(p_seed, 'seat:' || e.employee_id || ':' || t.tool_id) < t.assign_p
  ),
  weeks as (
    select (v_last_week - 7 * i)::date as week_start, 11 - i as week_index
    from generate_series(0, 11) as i
  ),
  hashed as (
    select
      s.employee_id,
      s.tool_id,
      w.week_start,
      s.regular_user,
      case
        when s.regular_user then least(0.97, 0.75 * s.mult * (0.85 + 0.15 * w.week_index / 11.0))
        else 0.06
      end as p_active,
      fow.seeded_hash(p_seed, 'usage:' || s.employee_id || ':' || s.tool_id || ':' || w.week_start) as h
    from seats s
    cross join weeks w
  ),
  draws as (
    select
      hs.*,
      fow.hash_unit(hs.h, 0) as u_active,
      fow.hash_unit(hs.h, 1) as u_days,
      fow.hash_unit(hs.h, 2) as u_sessions
    from hashed hs
  ),
  days as (
    select
      d.*,
      case
        when d.u_active < d.p_active
          then least(5, 1 + floor(d.u_days * case when d.regular_user then 5 else 2 end))::smallint
        else 0::smallint
      end as active_days
    from draws d
  )
  select employee_id, tool_id, week_start, active_days, (active_days * (1 + floor(u_sessions * 4)))::integer
  from days;

  -- Shadow AI: unapproved tool use, more common without a licensed seat.
  insert into fow.ai_usage_weekly (employee_id, tool_id, week_start, active_days, sessions)
  with weeks as (
    select (v_last_week - 7 * i)::date as week_start
    from generate_series(0, 11) as i
  ),
  draws as (
    select
      e.employee_id,
      w.week_start,
      fow.seeded_unit(p_seed, 'shadow-days:' || e.employee_id || ':' || w.week_start) as u_days
    from pg_temp.fow_seed_employees e
    cross join weeks w
    where fow.seeded_unit(p_seed, 'shadow:' || e.employee_id) < case when e.licensed then 0.06 else 0.25 end
      and fow.seeded_unit(p_seed, 'shadow-active:' || e.employee_id || ':' || w.week_start) < 0.5
  )
  select
    employee_id,
    'public-chatbot',
    week_start,
    (1 + floor(u_days * 3))::smallint,
    ((1 + floor(u_days * 3)) * 2)::integer
  from draws;

  -- Seats bought per approved tool: assigned seats rounded up to the next 50.
  update fow.ai_tools t
  set licenses = case
    when t.approved then coalesce((
      select (ceil(count(*) / 50.0) * 50)::integer
      from fow.ai_usage_weekly u
      where u.tool_id = t.tool_id and u.week_start = v_last_week
    ), 0)
    else 0
  end
  where true;

  -- AI pulse: two waves, about 62% response rate ----------------------------

  delete from fow.ai_pulse_responses where true;

  insert into fow.ai_pulse_responses (employee_id, question_code, score, response_date)
  with waves (wave, response_date) as (
    values (1, v_snapshot - 105), (2, v_snapshot - 15)
  ),
  respondents as (
    select e.*, w.wave, w.response_date, (e.licensed and e.regular_user) as ai_user
    from pg_temp.fow_seed_employees e
    cross join waves w
    where fow.seeded_unit(p_seed, 'respond:' || e.employee_id || ':' || w.wave) < 0.62
  ),
  answers as (
    select
      r.employee_id,
      q.question_code,
      r.response_date,
      case q.question_code
        when 'ai_helps_work' then
          case when r.ai_user then 4.0 else 3.0 end + case when r.wave = 2 then 0.1 else 0 end
        when 'ai_trust_output' then
          case when r.ai_user then 3.6 else 2.9 end + case when r.wave = 2 then 0.1 else 0 end
        when 'ai_training' then
          2.9
          + case when r.function_name in ('Engineering', 'Data & AI', 'Corporate Technology') then 0.6 else 0 end
          + case when r.ai_user then 0.2 else 0 end
        when 'ai_policy_clear' then
          3.0 + case when r.wave = 2 then 0.4 else 0 end
        when 'ai_manager_support' then
          3.3 + (r.adopt_p - 0.5)
        when 'ai_job_worry' then
          case when r.ai_user then 2.8 else 3.4 end
          + case when r.function_name in ('Customer Success', 'Operations') then 0.3 else 0 end
      end
      + 1.6 * (fow.hash_unit(n.h, 0) + fow.hash_unit(n.h, 1) + fow.hash_unit(n.h, 2) - 1.5) as raw_score
    from respondents r
    cross join fow.ai_pulse_questions q
    cross join lateral (
      select fow.seeded_hash(p_seed, 'pulse:' || r.employee_id || ':' || q.question_code || ':' || r.wave) as h
    ) n
    where q.question_code in (
      'ai_helps_work', 'ai_trust_output', 'ai_training',
      'ai_policy_clear', 'ai_manager_support', 'ai_job_worry'
    )
  )
  select employee_id, question_code, greatest(1, least(5, round(raw_score)))::smallint, response_date
  from answers;

  -- Governance register: 14 seeded HR AI use cases --------------------------
  -- Fixed ids (md5 of a key) so re-seeding updates rather than duplicates.

  insert into fow.ai_use_cases (
    use_case_id, name, hr_process, tool_id, decision_impact, owner,
    human_in_loop, status, description
  )
  select
    md5('fow-use-case:' || v.key)::uuid, v.name, v.hr_process, v.tool_id,
    v.decision_impact, v.owner, v.human_in_loop, v.status, v.description
  from (
    values
      ('resume-screening', 'Resume screening assistant', 'Recruiting', 'recruiting-copilot', 'informs', 'Talent Acquisition', true, 'production',
        'Ranks applicants against the job requirements; recruiters review every shortlist.'),
      ('performance-summaries', 'Performance review summaries', 'Performance', 'workspace-assistant', 'informs', 'Talent Management', true, 'pilot',
        'Drafts review summaries from goals and feedback for managers to edit.'),
      ('internal-mobility', 'Internal mobility matching', 'Internal mobility', 'analytics-copilot', 'informs', 'People Analytics', true, 'production',
        'Suggests open roles to employees based on skills and career preferences.'),
      ('policy-chatbot', 'HR policy chatbot', 'Employee service', 'enterprise-chat', 'none', 'HR Operations', false, 'production',
        'Answers policy questions from the HR knowledge base, with links to sources.'),
      ('interview-notes', 'Interview note-taker', 'Recruiting', 'meeting-notes', 'informs', 'Talent Acquisition', true, 'pilot',
        'Transcribes and summarizes interviews for the hiring panel.'),
      ('sourcing-outreach', 'Candidate outreach drafts', 'Recruiting', 'recruiting-copilot', 'none', 'Talent Acquisition', true, 'production',
        'Drafts outreach messages that recruiters edit and send.'),
      ('interview-scheduling', 'Interview scheduling agent', 'Recruiting', 'recruiting-copilot', 'none', 'Talent Acquisition', false, 'production',
        'Books interviews from recruiter-set slots and panel calendars.'),
      ('attrition-risk', 'Attrition risk model', 'Retention', 'analytics-copilot', 'informs', 'People Analytics', true, 'pilot',
        'Estimates flight risk by team for HR business partners.'),
      ('jd-writer', 'Job description writer', 'Recruiting', 'enterprise-chat', 'none', 'Talent Acquisition', true, 'production',
        'Drafts job descriptions from the job architecture; recruiters approve the final text.'),
      ('learning-recommendations', 'Learning recommendations', 'Learning', 'workspace-assistant', 'informs', 'Learning & Development', false, 'production',
        'Recommends courses based on role skill gaps.'),
      ('pay-equity', 'Pay equity analysis assistant', 'Compensation', 'analytics-copilot', 'informs', 'Total Rewards', true, 'pilot',
        'Flags unexplained pay gaps for analyst review.'),
      ('er-case-summaries', 'Employee relations case summaries', 'Employee relations', 'enterprise-chat', 'informs', 'Employee Relations', true, 'pilot',
        'Summarizes case notes for investigators.'),
      ('onboarding-assistant', 'Onboarding assistant', 'Onboarding', 'enterprise-chat', 'none', 'HR Operations', false, 'production',
        'Answers new-hire questions during the first 90 days.'),
      ('workforce-planning', 'Workforce planning scenario copilot', 'Workforce planning', 'analytics-copilot', 'informs', 'Workforce Planning', true, 'proposed',
        'Drafts headcount scenarios from the plan and attrition trends.')
  ) as v (key, name, hr_process, tool_id, decision_impact, owner, human_in_loop, status, description)
  on conflict (use_case_id) do update set
    name = excluded.name,
    hr_process = excluded.hr_process,
    tool_id = excluded.tool_id,
    decision_impact = excluded.decision_impact,
    owner = excluded.owner,
    human_in_loop = excluded.human_in_loop,
    status = excluded.status,
    description = excluded.description,
    updated_at = now();

  delete from fow.risk_assessments ra
  where ra.use_case_id in (
    select md5('fow-use-case:' || k)::uuid
    from unnest(array[
      'resume-screening', 'performance-summaries', 'internal-mobility', 'policy-chatbot',
      'interview-notes', 'sourcing-outreach', 'interview-scheduling', 'attrition-risk',
      'jd-writer', 'learning-recommendations', 'pay-equity', 'er-case-summaries',
      'onboarding-assistant', 'workforce-planning'
    ]) as k
  );

  insert into fow.risk_assessments (
    use_case_id, framework, tier, rationale, review_state, assessed_on,
    bias_audit_date, next_review_date
  )
  select
    md5('fow-use-case:' || v.key)::uuid, v.framework, v.tier, v.rationale, v.review_state,
    v.assessed_on::date, v.bias_audit_date::date, v.next_review_date::date
  from (
    values
      ('resume-screening', 'EU AI Act', 'high',
        'Annex III(4)(a): AI used to screen or filter job applications is high-risk.',
        'approved', '2026-02-10', null, '2027-02-10'),
      ('resume-screening', 'NYC LL 144', 'high',
        'Automated employment decision tool that substantially assists screening for New York City roles; needs an independent bias audit every year.',
        'approved', '2026-02-10', '2025-08-20', '2027-02-10'),
      ('performance-summaries', 'EU AI Act', 'high',
        'Annex III(4)(b): AI that evaluates the performance and behavior of workers is high-risk.',
        'in_review', '2026-09-08', null, '2027-01-15'),
      ('internal-mobility', 'EU AI Act', 'medium',
        'Recommends roles to employees. People make promotion decisions, but the output can steer who sees an opportunity.',
        'approved', '2026-04-01', null, '2027-04-01'),
      ('internal-mobility', 'NYC LL 144', 'medium',
        'Covers internal candidates for New York City roles; treated as an automated employment decision tool as a precaution.',
        'approved', '2026-04-01', '2026-03-12', '2027-03-12'),
      ('policy-chatbot', 'EU AI Act', 'low',
        'Limited risk: employees must be told they are talking to AI.',
        'approved', '2026-06-30', null, '2027-06-30'),
      ('interview-notes', 'EU AI Act', 'medium',
        'Summaries of interviews can shape hiring decisions even though no candidate is scored.',
        'draft', '2026-09-22', null, '2027-03-31'),
      ('sourcing-outreach', 'Internal', 'low',
        'Drafts messages a recruiter edits and sends; no candidate is scored or ranked.',
        'approved', '2026-05-31', null, '2027-05-31'),
      ('interview-scheduling', 'Internal', 'low',
        'Schedules from recruiter-set slots and calendar availability only.',
        'approved', '2025-09-01', null, '2026-09-01'),
      ('attrition-risk', 'EU AI Act', 'high',
        'Annex III(4)(b): predicting individual flight risk can affect how workers are treated.',
        'approved', '2025-07-31', null, '2026-07-31'),
      ('jd-writer', 'Internal', 'low',
        'Generates draft text only; recruiters approve every posting.',
        'approved', '2026-03-31', null, '2027-03-31'),
      ('learning-recommendations', 'EU AI Act', 'medium',
        'Course recommendations can shape access to development and progression.',
        'approved', '2026-08-31', null, '2027-08-31'),
      ('pay-equity', 'Internal', 'medium',
        'Uses pay and demographic data; flags gaps for analysts and makes no pay decision itself.',
        'in_review', '2026-09-15', null, '2027-01-31'),
      ('er-case-summaries', 'Internal', 'medium',
        'Processes sensitive case notes; investigators decide outcomes.',
        'approved', '2026-02-28', null, '2027-02-28'),
      ('onboarding-assistant', 'EU AI Act', 'low',
        'Limited risk chatbot answering onboarding questions.',
        'approved', '2026-07-31', null, '2027-07-31')
  ) as v (key, framework, tier, rationale, review_state, assessed_on, bias_audit_date, next_review_date);

  select jsonb_build_object(
    'seed', p_seed,
    'snapshot_date', v_snapshot,
    'last_usage_week', v_last_week,
    'dataset_jobs', (select count(*) from fow.dataset_jobs where dataset_id = 'builtin'),
    'ai_tools', (select count(*) from fow.ai_tools),
    'ai_usage_weekly', (select count(*) from fow.ai_usage_weekly),
    'ai_pulse_responses', (select count(*) from fow.ai_pulse_responses),
    'ai_use_cases', (select count(*) from fow.ai_use_cases),
    'risk_assessments', (select count(*) from fow.risk_assessments)
  ) into v_result;

  return v_result;
end;
$$;

comment on function fow.seed_builtin(integer) is
  'Seeds the builtin dataset and synthetic adoption, pulse, and governance data. Deterministic for a given seed (default 20261012).';

revoke execute on function fow.seeded_hash(integer, text), fow.hash_unit(text, integer),
  fow.seeded_unit(integer, text), fow.seed_builtin(integer) from public, anon, authenticated;
grant execute on function fow.seeded_hash(integer, text), fow.hash_unit(text, integer),
  fow.seeded_unit(integer, text), fow.seed_builtin(integer) to service_role;
