-- Future of Work Lab, milestone 7: validation of the exposure scores.
-- Creates three new tables in the fow schema (RLS on, no policies, service_role only).
-- No existing table, view, or public object is changed.

-- The stratified 100-task sample Ed labels in the admin review screen. One sample at a
-- time; it points at the exact score row (run_id, task_id) being judged.
create table fow.validation_sample (
  run_id uuid not null,
  task_id bigint not null,
  stratum text not null check (stratum in ('automate', 'augment', 'unaffected')),
  stratum_size integer not null check (stratum_size > 0),
  position integer not null check (position > 0) unique,
  drawn_at timestamptz not null default now(),
  primary key (run_id, task_id),
  foreign key (run_id, task_id) references fow.task_exposure_scores on delete cascade
);

comment on table fow.validation_sample is
  'Stratified (by model label) validation sample. stratum_size = tasks with that label when drawn. position interleaves strata, so any prefix is stratified too.';

-- A test-retest pass: the first 50 sample tasks scored again with the same prompt.
-- Kept apart from scoring_runs so the views, which read the latest scoring run per
-- task, never see these rows.
create table fow.retest_runs (
  retest_id uuid primary key default gen_random_uuid(),
  model text not null,
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

create table fow.retest_scores (
  retest_id uuid not null references fow.retest_runs on delete cascade,
  task_id bigint not null references fow.task_statements,
  label text not null check (label in ('automate', 'augment', 'unaffected')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  primary key (retest_id, task_id)
);

comment on table fow.retest_scores is
  'Second-pass labels for test-retest stability. Compared with the sample task''s original label on /methodology.';

alter table fow.validation_sample enable row level security;
alter table fow.retest_runs enable row level security;
alter table fow.retest_scores enable row level security;

grant all on fow.validation_sample, fow.retest_runs, fow.retest_scores to service_role;
