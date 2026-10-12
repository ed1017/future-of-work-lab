-- Future of Work Lab: fow schema, tables, RLS, and grants.
-- Creates objects in the fow schema only. Public tables are read by later
-- views and the seed; nothing here creates, alters, or references them.

create schema if not exists fow;

comment on schema fow is
  'Future of Work Lab. Server-only: the app reads it with the service role key. All employee-level data here is synthetic.';

-- Nothing in fow is reachable by anon or authenticated. Only service_role
-- (server code and scripts) gets access, granted at the end of this file.
revoke all on schema fow from public, anon, authenticated;
alter default privileges in schema fow revoke all on tables from public, anon, authenticated;
alter default privileges in schema fow revoke all on sequences from public, anon, authenticated;
alter default privileges in schema fow revoke execute on functions from public, anon, authenticated;

-- Job architecture -----------------------------------------------------------

create table fow.datasets (
  dataset_id text primary key check (dataset_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  name text not null,
  source text not null check (source in ('builtin', 'upload')),
  created_by text not null,
  created_at timestamptz not null default now()
);

comment on table fow.datasets is
  'One row for the builtin Supabase company (dataset_id builtin) and one per uploaded job architecture.';

create table fow.dataset_jobs (
  dataset_id text not null references fow.datasets on delete cascade,
  job_key text not null,
  title text not null,
  function_name text not null,
  family_name text not null,
  onetsoc_code text,
  headcount integer check (headcount >= 0),
  labor_cost_usd numeric(14, 2) check (labor_cost_usd >= 0),
  job_profile_id uuid,
  primary key (dataset_id, job_key)
);

comment on table fow.dataset_jobs is
  'Job architecture in one shape. Builtin rows come from public job tables and the latest employee snapshot; job_profile_id is set only for builtin rows.';
comment on column fow.dataset_jobs.job_profile_id is
  'public.job_profiles id for builtin rows (no foreign key, so public tables stay untouched).';

create index dataset_jobs_job_profile_idx on fow.dataset_jobs (job_profile_id);

-- Tasks and scoring ----------------------------------------------------------

create table fow.task_statements (
  task_id bigint primary key,
  onetsoc_code text,
  task_text text not null,
  task_type text,
  importance numeric(4, 2),
  frequency numeric(4, 2),
  source text not null default 'onet' check (source in ('onet', 'custom'))
);

comment on table fow.task_statements is
  'O*NET task statements and ratings (loaded in milestone 3), plus custom tasks from uploads.';

create index task_statements_onetsoc_idx on fow.task_statements (onetsoc_code);

create table fow.job_tasks (
  dataset_id text not null,
  job_key text not null,
  task_id bigint not null references fow.task_statements,
  time_share numeric(8, 6) not null check (time_share > 0 and time_share <= 1),
  primary key (dataset_id, job_key, task_id),
  foreign key (dataset_id, job_key) references fow.dataset_jobs on delete cascade
);

comment on table fow.job_tasks is
  'Tasks per job. time_share sums to 1.0 per job.';

create index job_tasks_task_idx on fow.job_tasks (task_id);

create table fow.scoring_runs (
  run_id uuid primary key default gen_random_uuid(),
  dataset_id text references fow.datasets on delete set null,
  model text not null,
  rubric_version text not null,
  prompt_sha text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  tasks_scored integer not null default 0 check (tasks_scored >= 0),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(10, 4),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table fow.scoring_runs is
  'Audit trail for every scoring pass. Rows are never overwritten by a later run.';

create table fow.task_exposure_scores (
  run_id uuid not null references fow.scoring_runs on delete cascade,
  task_id bigint not null references fow.task_statements,
  label text not null check (label in ('automate', 'augment', 'unaffected')),
  exposure numeric(3, 2) not null check (exposure between 0 and 1),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  rationale text not null check (
    cardinality(regexp_split_to_array(btrim(rationale), '\s+')) <= 40
  ),
  created_at timestamptz not null default now(),
  primary key (run_id, task_id)
);

comment on table fow.task_exposure_scores is
  'One model judgment per task per run. Rationale is capped at 40 words.';

create index task_exposure_scores_task_idx on fow.task_exposure_scores (task_id);

create table fow.score_reviews (
  review_id bigint generated always as identity primary key,
  run_id uuid not null,
  task_id bigint not null,
  reviewer text not null,
  agrees boolean not null,
  override_label text check (override_label in ('automate', 'augment', 'unaffected')),
  note text,
  reviewed_at timestamptz not null default now(),
  foreign key (run_id, task_id) references fow.task_exposure_scores on delete cascade,
  unique (run_id, task_id, reviewer)
);

comment on table fow.score_reviews is
  'SME validation sample: agreement with the model label, or an override.';

-- Adoption (synthetic) -------------------------------------------------------

create table fow.ai_tools (
  tool_id text primary key check (tool_id ~ '^[a-z0-9-]+$'),
  name text not null,
  category text not null,
  licenses integer not null default 0 check (licenses >= 0),
  approved boolean not null
);

comment on table fow.ai_tools is
  'Synthetic AI tool catalog. approved = false marks unsanctioned tools seen in usage telemetry (shadow AI).';

create table fow.ai_usage_weekly (
  employee_id uuid not null,
  tool_id text not null references fow.ai_tools on update cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  active_days smallint not null check (active_days between 0 and 7),
  sessions integer not null check (sessions >= 0),
  primary key (employee_id, tool_id, week_start)
);

comment on table fow.ai_usage_weekly is
  'Synthetic weekly usage. Approved tools report a row per licensed seat per week, including zero-activity weeks; unapproved tools only appear when used.';

create index ai_usage_weekly_week_idx on fow.ai_usage_weekly (week_start, tool_id);

create table fow.ai_pulse_questions (
  question_code text primary key,
  question_text text not null,
  reverse_scored boolean not null default false
);

comment on table fow.ai_pulse_questions is
  'Wording for the synthetic AI pulse survey. reverse_scored = true means agreement is unfavorable.';

create table fow.ai_pulse_responses (
  response_id bigint generated always as identity primary key,
  employee_id uuid not null,
  question_code text not null references fow.ai_pulse_questions on update cascade,
  score smallint not null check (score between 1 and 5),
  response_date date not null,
  unique (employee_id, question_code, response_date)
);

comment on table fow.ai_pulse_responses is
  'Synthetic AI sentiment pulse, 1-5 agreement scale.';

create index ai_pulse_responses_date_idx on fow.ai_pulse_responses (response_date, question_code);

-- Governance -----------------------------------------------------------------

create table fow.ai_use_cases (
  use_case_id uuid primary key default gen_random_uuid(),
  name text not null,
  hr_process text not null,
  tool_id text references fow.ai_tools on update cascade on delete set null,
  decision_impact text not null check (decision_impact in ('none', 'informs', 'determines')),
  owner text not null,
  human_in_loop boolean not null,
  status text not null check (status in ('proposed', 'pilot', 'production', 'retired')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table fow.ai_use_cases is
  'HR AI governance register. owner is a team, not a person.';
comment on column fow.ai_use_cases.decision_impact is
  'none: no employment decision; informs: a person decides using the output; determines: the output decides.';

create table fow.risk_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  use_case_id uuid not null references fow.ai_use_cases on delete cascade,
  framework text not null check (framework in ('EU AI Act', 'NYC LL 144', 'NIST AI RMF', 'Internal')),
  tier text not null check (tier in ('low', 'medium', 'high')),
  rationale text not null,
  review_state text not null default 'draft' check (review_state in ('draft', 'in_review', 'approved', 'changes_requested')),
  assessed_on date not null,
  bias_audit_date date,
  next_review_date date,
  unique (use_case_id, framework, assessed_on)
);

comment on table fow.risk_assessments is
  'Risk tier per framework per assessment. The latest assessment per framework is current.';

create index risk_assessments_use_case_idx on fow.risk_assessments (use_case_id, framework, assessed_on desc);

-- Action planner -------------------------------------------------------------

create table fow.action_recommendations (
  recommendation_id uuid primary key default gen_random_uuid(),
  run_id uuid references fow.scoring_runs on delete set null,
  dataset_id text not null references fow.datasets on delete cascade,
  scope_key text not null,
  move text not null check (move in ('reskill', 'redesign', 'redeploy', 'hold')),
  text text not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  model text,
  created_at timestamptz not null default now()
);

comment on table fow.action_recommendations is
  'Model recommendations per scope (a function name), each with an evidence array that points back to view rows.';

create index action_recommendations_dataset_idx on fow.action_recommendations (dataset_id, scope_key);

-- RLS: on for every table, with no policies. anon and authenticated have no
-- grants either; service_role bypasses RLS.
alter table fow.datasets enable row level security;
alter table fow.dataset_jobs enable row level security;
alter table fow.task_statements enable row level security;
alter table fow.job_tasks enable row level security;
alter table fow.scoring_runs enable row level security;
alter table fow.task_exposure_scores enable row level security;
alter table fow.score_reviews enable row level security;
alter table fow.ai_tools enable row level security;
alter table fow.ai_usage_weekly enable row level security;
alter table fow.ai_pulse_questions enable row level security;
alter table fow.ai_pulse_responses enable row level security;
alter table fow.ai_use_cases enable row level security;
alter table fow.risk_assessments enable row level security;
alter table fow.action_recommendations enable row level security;

grant usage on schema fow to service_role;
grant all on all tables in schema fow to service_role;
grant all on all sequences in schema fow to service_role;
alter default privileges in schema fow grant all on tables to service_role;
alter default privileges in schema fow grant all on sequences to service_role;
alter default privileges in schema fow grant execute on functions to service_role;
