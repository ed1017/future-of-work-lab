-- Milestone 3 acceptance check. Run in the Supabase SQL editor (or psql) as postgres
-- after `npm run score -- --dataset builtin` (or the Score exposure workflow) succeeds.
-- 1. Every builtin job has O*NET tasks whose time shares sum to 1.
-- 2. Every one of those tasks has a score from a succeeded run.
-- 3. At least one succeeded scoring_runs row records its cost.

select r.run_id, r.model, r.rubric_version, left(r.prompt_sha, 12) as prompt_sha, r.status,
  r.tasks_scored, r.input_tokens, r.output_tokens, r.cost_usd, r.started_at, r.finished_at
from fow.scoring_runs r
order by r.started_at desc;

select
  count(*) as jobs,
  count(*) filter (where tasks_total > 0) as jobs_with_tasks,
  count(*) filter (where tasks_total > 0 and tasks_scored = tasks_total) as jobs_fully_scored,
  sum(tasks_total) as job_tasks,
  round(avg(exposure_score), 3) as avg_exposure_score
from fow.v_job_exposure
where dataset_id = 'builtin';

do $$
declare
  n integer;
begin
  select count(*) into n from fow.dataset_jobs where dataset_id = 'builtin';
  if n <> 50 then
    raise exception 'expected 50 builtin jobs, found %', n;
  end if;

  select count(*) into n
  from fow.dataset_jobs dj
  where dj.dataset_id = 'builtin'
    and not exists (select 1 from fow.job_tasks jt where jt.dataset_id = dj.dataset_id and jt.job_key = dj.job_key);
  if n > 0 then
    raise exception '% builtin jobs have no tasks', n;
  end if;

  select count(*) into n
  from (
    select job_key from fow.job_tasks where dataset_id = 'builtin'
    group by job_key having abs(sum(time_share) - 1) > 0.000001
  ) x;
  if n > 0 then
    raise exception '% builtin jobs have time shares that do not sum to 1', n;
  end if;

  select count(*) into n
  from fow.v_job_exposure
  where dataset_id = 'builtin' and tasks_scored < tasks_total;
  if n > 0 then
    raise exception '% builtin jobs have unscored tasks', n;
  end if;

  select count(*) into n
  from fow.scoring_runs
  where status = 'succeeded' and tasks_scored > 0 and cost_usd is not null;
  if n = 0 then
    raise exception 'no succeeded scoring run with cost recorded';
  end if;

  raise notice 'all 50 builtin jobs have every mapped task scored, and a scoring run recorded its cost';
end $$;
