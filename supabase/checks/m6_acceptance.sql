-- Milestone 6 acceptance check. Run in the Supabase SQL editor (or psql) as postgres
-- after `npm run plan` (or the Plan actions workflow) succeeds.
-- Done when every recommendation in the newest batch names at least two data points
-- (evidence items of kind "metric") that exist in the views. A data point exists when
-- its view has exactly one row matching its key and that row's cited column is not null;
-- "matching" also requires the value the recommendation quoted to be unchanged.

with newest as (
  select *
  from fow.action_recommendations
  where dataset_id = 'builtin'
    and created_at = (select max(created_at) from fow.action_recommendations where dataset_id = 'builtin')
),
view_rows as (
  select 'v_function_exposure' as view, to_jsonb(v) as j from fow.v_function_exposure v
  union all select 'v_exposure_adoption', to_jsonb(v) from fow.v_exposure_adoption v
  union all select 'v_job_exposure', to_jsonb(v) from fow.v_job_exposure v
  union all select 'v_adoption_manager', to_jsonb(v) from fow.v_adoption_manager v
  union all select 'v_pulse_sentiment', to_jsonb(v) from fow.v_pulse_sentiment v
  union all select 'v_register', to_jsonb(v) from fow.v_register v
  union all select 'v_function_readiness', to_jsonb(v) from fow.v_function_readiness v
  union all select 'v_function_skill_gaps', to_jsonb(v) from fow.v_function_skill_gaps v
  union all select 'v_redeployment_paths', to_jsonb(v) from fow.v_redeployment_paths v
  union all select 'v_course_catalog', to_jsonb(v) from fow.v_course_catalog v
),
cited as (
  select
    n.scope_key,
    n.move,
    e.item,
    (
      select count(*)
      from view_rows r
      where r.view = e.item->>'view'
        and r.j @> (e.item->'key')
    ) as rows_found,
    (
      select r.j -> (e.item->>'field')
      from view_rows r
      where r.view = e.item->>'view'
        and r.j @> (e.item->'key')
      limit 1
    ) as current_value
  from newest n
  cross join lateral jsonb_array_elements(n.evidence) as e(item)
  where e.item->>'kind' = 'metric'
),
judged as (
  select
    c.*,
    c.rows_found = 1 and c.current_value is not null and c.current_value <> 'null'::jsonb as data_point_exists,
    case
      when jsonb_typeof(c.current_value) = 'number' and jsonb_typeof(c.item->'value') = 'number'
        then abs((c.current_value)::text::numeric - (c.item->'value')::text::numeric) <= 0.000001
      else c.current_value = c.item->'value'
    end as value_matches
  from cited c
)
select
  scope_key as function_name,
  move,
  count(*) as metric_data_points,
  count(*) filter (where data_point_exists) as existing_in_views,
  count(*) filter (where data_point_exists and value_matches) as matching_value,
  count(*) filter (where data_point_exists) >= 2 as passes
from judged
group by scope_key, move
order by scope_key;

-- The same check as an assertion: raises an error if any recommendation falls short.
do $$
declare
  batch_size integer;
  failing text;
begin
  select count(*) into batch_size
  from fow.action_recommendations
  where dataset_id = 'builtin'
    and created_at = (select max(created_at) from fow.action_recommendations where dataset_id = 'builtin');
  if batch_size = 0 then
    raise exception 'no recommendations for the builtin dataset';
  end if;

  with newest as (
    select *
    from fow.action_recommendations
    where dataset_id = 'builtin'
      and created_at = (select max(created_at) from fow.action_recommendations where dataset_id = 'builtin')
  ),
  view_rows as (
    select 'v_function_exposure' as view, to_jsonb(v) as j from fow.v_function_exposure v
    union all select 'v_exposure_adoption', to_jsonb(v) from fow.v_exposure_adoption v
    union all select 'v_job_exposure', to_jsonb(v) from fow.v_job_exposure v
    union all select 'v_adoption_manager', to_jsonb(v) from fow.v_adoption_manager v
    union all select 'v_pulse_sentiment', to_jsonb(v) from fow.v_pulse_sentiment v
    union all select 'v_register', to_jsonb(v) from fow.v_register v
    union all select 'v_function_readiness', to_jsonb(v) from fow.v_function_readiness v
    union all select 'v_function_skill_gaps', to_jsonb(v) from fow.v_function_skill_gaps v
    union all select 'v_redeployment_paths', to_jsonb(v) from fow.v_redeployment_paths v
    union all select 'v_course_catalog', to_jsonb(v) from fow.v_course_catalog v
  ),
  per_rec as (
    select
      n.scope_key,
      count(*) filter (
        where e.item->>'kind' = 'metric'
          and (select count(*) from view_rows r where r.view = e.item->>'view' and r.j @> (e.item->'key')) = 1
          and (select r.j -> (e.item->>'field') from view_rows r where r.view = e.item->>'view' and r.j @> (e.item->'key') limit 1)
            not in ('null'::jsonb)
      ) as existing
    from newest n
    left join lateral jsonb_array_elements(n.evidence) as e(item) on true
    group by n.scope_key
  )
  select string_agg(scope_key, ', ') into failing from per_rec where existing < 2;

  if failing is not null then
    raise exception 'these recommendations cite fewer than 2 data points that exist in the views: %', failing;
  end if;
  raise notice 'milestone 6 check passed: all % recommendations cite at least 2 data points that exist in the views', batch_size;
end
$$;
