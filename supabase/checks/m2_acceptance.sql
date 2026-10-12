-- Milestone 2 acceptance check. Run in the Supabase SQL editor (or psql) as postgres.
-- 1. Each view returns rows. 2. anon and authenticated cannot read
-- employee-level tables (public or fow) or anything else in fow.

select 'v_job_exposure' as view_name, count(*) as row_count from fow.v_job_exposure
union all select 'v_function_exposure', count(*) from fow.v_function_exposure
union all select 'v_exposure_adoption', count(*) from fow.v_exposure_adoption
union all select 'v_register', count(*) from fow.v_register;

do $$
declare
  r text;
  t text;
  n integer;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array[
      'public.employees', 'public.employee_snapshots', 'public.employee_demographics',
      'fow.ai_usage_weekly', 'fow.ai_pulse_responses', 'fow.dataset_jobs',
      'fow.v_job_exposure', 'fow.v_function_exposure', 'fow.v_exposure_adoption', 'fow.v_register'
    ] loop
      perform set_config('role', r, true);
      begin
        execute format('select count(*) from (select 1 from %s limit 1) x', t) into n;
        if n > 0 then
          raise exception '% can read rows from %', r, t;
        end if;
      exception when insufficient_privilege then
        null; -- expected: permission denied
      end;
      perform set_config('role', 'postgres', true);
    end loop;
  end loop;
  raise notice 'anon and authenticated cannot read employee-level tables or fow objects';
end $$;
