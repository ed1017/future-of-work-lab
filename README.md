# Future of Work Lab

Where does AI change work here first, are people using AI safely, and what should HR do about it? Future of Work Lab scores task-level AI exposure for a job architecture, joins it to adoption and governance data, and turns it into an action plan. All employee data is synthetic.

The full build spec is in [docs/SPEC.md](docs/SPEC.md). This repo is being built one milestone at a time; milestone 2 adds the database schema and seed.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in values; all are server only
npm run dev
```

### Database

Everything lives in the `fow` schema of the Supabase project; public tables are read, never written.

1. Apply `supabase/migrations/*.sql` in order (Supabase SQL editor, or `supabase db push`).
2. Seed: run `select fow.seed_builtin();` in the SQL editor. The default seed, 20261012, always produces the same rows; pass another integer for a different draw. It takes about 15 seconds, longer than the Data API's 8-second limit, so it runs in SQL rather than through an npm script.
3. In Supabase, add `fow` to Settings → Data API → Exposed schemas, so server code can reach it with the service role key (needed from milestone 4).
4. Check: run `supabase/checks/m2_acceptance.sql`. It counts rows in the four views and fails if `anon` or `authenticated` can read employee-level tables or anything in `fow`.

`fow` has RLS on every table and no grants to `anon` or `authenticated`; only `service_role` can read it. The four views (`v_job_exposure`, `v_function_exposure`, `v_exposure_adoption`, `v_register`) null out employee-derived numbers for any group under 10 employees. Exposure columns stay null until milestone 3 scores tasks.

## Scripts

- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Node test runner over `tests/**/*.test.mjs`
- `npm run score -- --dataset <id>`: exposure scoring (stub until milestone 3)
