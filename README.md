# Future of Work Lab

Where does AI change work here first, are people using AI safely, and what should HR do about it? Future of Work Lab scores task-level AI exposure for a job architecture, joins it to adoption and governance data, and turns it into an action plan. All employee data is synthetic.

The full build spec is in [docs/SPEC.md](docs/SPEC.md). This repo is being built one milestone at a time; milestone 3 adds O*NET task import and exposure scoring.

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
3. In Supabase, add `fow` to Settings → Data API → Exposed schemas, so server code can reach it with the service role key (needed for scoring and the app).
4. Check: run `supabase/checks/m2_acceptance.sql`. It counts rows in the four views and fails if `anon` or `authenticated` can read employee-level tables or anything in `fow`.

5. Score: `npm run score -- --dataset builtin` (see below). Then run `supabase/checks/m3_acceptance.sql`.

`fow` has RLS on every table and no grants to `anon` or `authenticated`; only `service_role` can read it. The four views (`v_job_exposure`, `v_function_exposure`, `v_exposure_adoption`, `v_register`) null out employee-derived numbers for any group under 10 employees. Exposure columns stay null until a scoring run succeeds.

## Scripts

- `npm run lint`: ESLint
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Node test runner over `tests/**/*.test.mjs`
- `npm run score -- --dataset <id>`: exposure scoring (below)

## Exposure scoring

`npm run score -- --dataset <id>` runs the pipeline in `scripts/score.mjs`, from a laptop (reads `.env.local`) or the **Score exposure** GitHub Action. It never runs inside a Vercel request.

1. **Load tasks.** For each O*NET code in the dataset with no tasks yet, it downloads the O*NET text release (default 31.0, `--onet-release` to change; `--onet-dir` reads `Task Statements.txt` and `Task Ratings.txt` from a folder instead) and loads the tasks into `fow.task_statements`. Importance is the IM rating; frequency is the expected FT category (1 = yearly or less, 7 = hourly or more). A task without ratings gets its occupation's mean.
2. **Build job tasks.** It rebuilds `fow.job_tasks` for the dataset: each job gets its occupation's tasks, with time share = importance x frequency, normalized so every job sums to exactly 1.
3. **Score.** Tasks with no score under the current rubric version go to `OPENAI_MODEL` in batches of up to 25 from one occupation, with the company's job titles for that occupation as context. The system prompt is `prompts/exposure-v1.md`. Each response must pass the zod schemas in `lib/scoring/rubric.mjs` (every task once, a rubric label, the label's exposure value, a rationale of 40 words or fewer); invalid batches are retried up to 3 times. Temperature is 0, except for models that reject the parameter, which run at their default.
4. **Record the run.** A new `fow.scoring_runs` row holds the model, rubric version, prompt SHA-256, token counts, cost (from `OPENAI_PRICE_INPUT_PER_1M` and `OPENAI_PRICE_OUTPUT_PER_1M`), and status. Earlier runs are never changed. The views read each task's latest succeeded score.

Scores are cached per task and rubric version, so a second run, or a dataset that maps to O*NET codes already scored, makes no model calls. `--dry-run` stops after step 2.

To run it in GitHub Actions, add repository secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`, and variables `OPENAI_MODEL`, `OPENAI_PRICE_INPUT_PER_1M`, and `OPENAI_PRICE_OUTPUT_PER_1M`. Then start **Score exposure** from the Actions tab, or add the `run-scoring` label to a pull request to score from its branch. The script reaches `fow` through the Data API, so `fow` must be in Supabase's exposed schemas (step 3 above).

Task data comes from [O*NET](https://www.onetcenter.org/database.html) by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license. O*NET is a trademark of USDOL/ETA. The task-to-AI exposure labels are this project's own model output, not O*NET data.
