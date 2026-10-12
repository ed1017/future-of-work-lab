-- Future of Work Lab: deterministic random helpers for the seed.
-- Every random draw comes from an md5 of the seed and a stable key such as
-- employee id + tool + week. The same seed and the same public company data
-- always give the same rows, whatever the row order.
-- These helpers have no SET search_path on purpose: that keeps them
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

revoke execute on function fow.seeded_hash(integer, text), fow.hash_unit(text, integer),
  fow.seeded_unit(integer, text) from public, anon, authenticated;
grant execute on function fow.seeded_hash(integer, text), fow.hash_unit(text, integer),
  fow.seeded_unit(integer, text) to service_role;
