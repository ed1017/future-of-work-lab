# Future of Work Lab — Build Spec

Oct 12, 2026 · Ed

## Overview

Future of Work Lab answers three questions a CHRO is being asked now: where AI changes work here first, whether people are actually using AI safely, and what to do about it. It runs on the synthetic company already in Ed's Supabase project and is built so another company can load its own job architecture and use-case list.

It is portfolio #2, in the HR AI lane. It stays separate from the SWP app at ed-ai.app: SWP covers headcount supply and demand, while this covers how the work itself changes and whether AI use is governed.

### Success criteria

- A recruiter can open the live URL and understand the story in under 60 seconds from the Overview screen.
- Every score and recommendation links back to the rows and rubric that produced it.
- A new job architecture CSV can be uploaded and re-scored end to end without code changes.
- A 3–4 minute demo video walks the stakeholder story from exposure to action plan.
- The README explains the methodology, its limits, and how to run it locally.

## Stack and repo setup

Reuse the people-analytics-ai stack as-is, in a new GitHub repo (`future-of-work-lab`) and a new Vercel Pro project. Point it at the same Supabase project (Ed's People Analytics Database), but keep every new table in a separate `fow` schema.

| Layer | Choice | Note |
| --- | --- | --- |
| Framework | Next.js 16, React 19, TypeScript | App Router, server components for all data reads |
| UI | Tailwind CSS 4, shadcn/ui, Base UI | Match ed-ai.app tokens so both projects read as one portfolio |
| Charts, icons | Recharts 3, Lucide | Quadrant = Recharts ScatterChart; bars = BarChart |
| Backend | Next.js server actions and API routes | Long scoring runs are a Node script, not a Vercel function |
| Database | Supabase Postgres, `fow` schema | Reads public tables; never writes to them |
| AI | OpenAI API via OpenAI SDK 7 | Structured JSON output validated with zod; model set by env var |
| Hosting, analytics | Vercel Pro, Vercel Analytics | Separate project and domain from ed-ai.app |
| Testing | Node test runner, `tsc --noEmit`, ESLint | Same scripts as the existing repo |

### Environment variables

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`)
- `OPENAI_API_KEY`, `OPENAI_MODEL` (default to the model ed-ai.app uses)
- `ADMIN_EMAIL` (the one account allowed to run scoring and edit the register)

### Data safety rules

- The browser never receives employee-level rows. Server code returns aggregates only.
- Any group under 10 employees is suppressed in every view and chart.
- RLS is on for every `fow` table; anonymous visitors can read aggregate views only.
- `employee_demographics` is used only for the optional equity check, aggregated, never displayed per person.

## Data model

The app reads the existing public company tables and writes only to a new `fow` schema. Every score hangs off a dataset, so the built-in company and an uploaded job architecture run through exactly the same pipeline.

### Reused from public (read only)

| Table | Rows | Used for |
| --- | --- | --- |
| `company_profile` | 1 | Company name and headcount on the header |
| `job_functions`, `job_families`, `job_profiles` | 15 / 43 / 50 | The job architecture that gets scored |
| `job_onet_mapping`, `onet_occupations` | 50 / 1,016 | Links each job profile to an O*NET occupation |
| `employee_snapshots` (latest `snapshot_date`) | 304,203 | Headcount and `total_labor_cost_usd` per job profile for weighting |
| `org_units`, `employees` | 27 / 12,880 | Function and manager roll-ups (aggregated only) |
| `skills`, `job_skill_requirements`, `employee_skills` | 98 / 377 / 131,357 | Reskilling paths in the action planner |
| `learning_courses`, `career_preferences` | 25 / 5,500 | Course and redeployment suggestions |
| `employee_demographics` | 12,828 | Optional aggregate equity check on exposure |

### New in fow

| Table | Key columns | Purpose |
| --- | --- | --- |
| `datasets` | `dataset_id`, `name`, `source` (builtin, upload), `created_by` | One row for the Supabase company, one per upload |
| `dataset_jobs` | `dataset_id`, `job_key`, `title`, `function_name`, `family_name`, `onetsoc_code`, `headcount`, `labor_cost_usd` | Job architecture in one shape; builtin rows filled from public |
| `task_statements` | `task_id`, `onetsoc_code`, `task_text`, `task_type`, `importance`, `frequency` | O*NET task statements and ratings (not loaded yet) |
| `job_tasks` | `dataset_id`, `job_key`, `task_id`, `time_share` | Tasks per job, with time share summing to 1.0 per job |
| `scoring_runs` | `run_id`, `model`, `rubric_version`, `prompt_sha`, `status`, `tasks_scored`, `cost_usd` | Audit trail for every scoring pass |
| `task_exposure_scores` | `run_id`, `task_id`, `label` (automate, augment, unaffected), `exposure` 0–1, `confidence`, `rationale` | One model judgment per task per run |
| `score_reviews` | `task_id`, `run_id`, `reviewer`, `agrees`, `override_label`, `note` | SME validation sample |
| `ai_tools` | `tool_id`, `name`, `category`, `licenses`, `approved` | Synthetic AI tool catalog |
| `ai_usage_weekly` | `employee_id`, `tool_id`, `week_start`, `active_days`, `sessions` | Synthetic adoption data |
| `ai_pulse_responses` | `employee_id`, `question_code`, `score`, `response_date` | Synthetic AI sentiment survey |
| `ai_use_cases` | `use_case_id`, `name`, `hr_process`, `tool_id`, `decision_impact`, `owner`, `human_in_loop`, `status` | Governance register |
| `risk_assessments` | `use_case_id`, `framework`, `tier`, `rationale`, `bias_audit_date`, `next_review_date` | Risk tiering per framework |
| `action_recommendations` | `run_id`, `dataset_id`, `scope_key`, `move` (reskill, redesign, redeploy, hold), `text`, `evidence` jsonb | Model output with its data trace |

### Views the UI reads (aggregates only)

- `v_job_exposure`: per job, exposure = sum of `time_share` where label is automate or augment, split by label.
- `v_function_exposure`: headcount- and cost-weighted roll-up by function.
- `v_exposure_adoption`: job family exposure joined to weekly active-user rate, with headcount for bubble size.
- `v_register`: use cases with their current risk tier and review status.

All synthetic `fow` data (usage, pulse, use cases) is seeded by a script in the repo with a fixed random seed, so the demo is reproducible.

## Exposure scoring pipeline

Each O*NET task is scored once per rubric version by the OpenAI model and cached, so re-scoring a new dataset mostly reuses existing scores. The pipeline runs as `npm run score -- --dataset <id>` from a laptop or a GitHub Action, never inside a Vercel request.

### Rubric (v1)

| Label | Definition | Exposure value |
| --- | --- | --- |
| Automate | Current AI tools can complete the task end to end; a person reviews the output | 1.0 |
| Augment | AI cuts the time a skilled person needs by roughly half or more, but a person still does the work | 0.5 |
| Unaffected | Physical, relational, or judgment-heavy work where AI saves little time today | 0.0 |

### Steps

1. **Load tasks.** Import O*NET Task Statements and Task Ratings into `fow.task_statements` for every `onetsoc_code` in `job_onet_mapping`.
2. **Build job tasks.** For each job, set `time_share` from importance × frequency, normalized to 1.0. Custom tasks from an upload get equal shares.
3. **Score.** Send tasks in batches of 25 with the job title for context. The response is a JSON array validated by a zod schema: `task_id`, `label`, `exposure`, `confidence` (low, medium, high), and a `rationale` under 40 words.
4. **Record the run.** Write the model name, rubric version, prompt hash, token cost, and row count to `scoring_runs`. Never overwrite an older run.
5. **Roll up.** Refresh the views so job exposure = Σ time_share × exposure, then weight by headcount or labor cost for function and company totals.
6. **Validate.** Pull a stratified sample of 100 tasks for Ed to label in an admin review screen. Report percent agreement and Cohen's kappa on the Methodology page, plus a test–retest check that re-scores 50 tasks and reports label stability.

### Guardrails

- Temperature 0 and a fixed system prompt stored in the repo (`prompts/exposure-v1.md`), hashed into each run.
- Uploads that map to O*NET codes reuse cached scores with no model calls. Scoring free-text custom tasks is admin-only, to cap cost.
- The Methodology page states the limits plainly: exposure measures task overlap with AI capability, not job loss, and it says nothing about timing.

## Screens

Seven routes, matching the approved Overview mockup. Every number on screen has a hover or link that shows the view and filter it came from.

| Route | What it shows | Reads from |
| --- | --- | --- |
| `/` Overview | 4 KPI tiles, exposure × adoption quadrant, exposure by function, register preview, top 4 actions | All four views, `action_recommendations` |
| `/exposure` | Function → family → job drill-down; task list per job with label, rationale, and confidence | `v_job_exposure`, `task_exposure_scores` |
| `/adoption` | Active-user rate by function and manager, tool mix, pulse sentiment, the enable-first list | `v_exposure_adoption`, `ai_usage_weekly`, `ai_pulse_responses` |
| `/governance` | Use-case register with filters, risk tier badges, overdue reviews; admin can add and edit | `v_register`, `risk_assessments` |
| `/actions` | Plan per function: move, rationale, evidence links, suggested courses and redeployment targets | `action_recommendations`, `skills`, `learning_courses`, `career_preferences` |
| `/methodology` | Rubric, prompt, validation results (agreement, kappa, stability), limits, data dictionary | `scoring_runs`, `score_reviews` |
| `/upload` | CSV upload with a column-mapping step, validation report, then a new dataset view | `datasets`, `dataset_jobs` |

Upload format: `job_title`, `function`, `family`, `onet_code`, `headcount`, `avg_annual_cost_usd`. `onet_code` is optional; rows without it get a suggested match the user confirms. A downloadable template and a 20-row sample file sit on the page.

Header controls: dataset switcher (builtin company or an upload), function filter, and a headcount-weighted vs. cost-weighted toggle that every chart respects.

## Build order

Give Codex one milestone per task and merge each through a pull request before starting the next. Each milestone is done only when its acceptance check passes.

1. **Scaffold.** New repo from the same Next.js, Tailwind, and shadcn setup; copy lint, tsconfig, and test scripts from people-analytics-ai.
   - Done when `npm run lint`, `npm run typecheck`, and `npm test` pass and a placeholder page deploys to the new Vercel project.
2. **Schema and seed.** SQL migrations for the `fow` schema, RLS policies, and the four views; a seed script for the builtin dataset and synthetic usage, pulse, and use-case data.
   - Done when the views return rows and no anonymous query can read an employee-level table.
3. **O*NET tasks and scoring.** Task import, `job_tasks` builder, scoring script, and run logging.
   - Done when all 50 job profiles have a score for every mapped task and a `scoring_runs` row with cost recorded.
4. **Overview and Exposure screens.** Match the mockup; quadrant and bars in Recharts.
   - Done when every KPI and chart value matches a SQL query listed in a test fixture.
5. **Adoption and Governance screens.** Register CRUD behind admin sign-in.
   - Done when an anonymous visitor can view but not edit, and overdue reviews are flagged.
6. **Action planner.** Model generates one recommendation per function from the views, with an evidence JSON that the UI renders as links.
   - Done when every recommendation names at least two data points that exist in the views.
7. **Methodology and validation.** Admin review screen for the 100-task sample; agreement and kappa shown on `/methodology`.
   - Done when Ed has labeled the sample and the page shows the result.
8. **Upload.** CSV mapping, validation, new dataset, cached re-scoring.
   - Done when the 20-row sample file produces a full Overview in under 30 seconds with no model calls.
9. **Polish, README, video.** Empty and error states, mobile layout, Vercel Analytics, then record the demo.
   - Done when the checklist in the next section is complete.

## Testing, demo video, and README

### Tests (Node test runner)

- Exposure math: time shares sum to 1.0 per job; roll-ups match hand-computed fixtures for headcount and cost weighting.
- Model output: the zod schema rejects missing labels, out-of-range exposure, and rationales over 40 words.
- Small-group suppression: any aggregate under 10 employees returns null.
- CSV upload: bad headers, duplicate jobs, and non-numeric headcount produce clear row-level errors.
- Access: an anonymous Supabase client cannot select from `employees`, `employee_snapshots`, or `employee_demographics`.

### Demo video (3–4 minutes)

1. The ask: "Our CHRO wants to know where AI hits us first."
2. Overview: the quadrant and the enable-first roles.
3. Exposure drill-down to one job's tasks and rationales.
4. Governance: a high-risk screening tool with a bias audit due.
5. Action plan with its evidence links.
6. Upload the sample CSV and show the same story for a "new company."
7. Close on the Methodology page and validation result.

### README checklist

- One-paragraph pitch, live URL, and video link at the top
- Screenshot of the Overview
- Architecture and data model summary
- Rubric, validation result, and stated limits
- Local setup: env vars, migrations, seed, scoring
- Note that all employee data is synthetic

## Codex kickoff prompt

Save this spec as `docs/SPEC.md` in the new repo, add the AGENTS.md block as `AGENTS.md`, then give Codex milestone 1.

### First task for Codex

> Read AGENTS.md and docs/SPEC.md. Complete milestone 1 (Scaffold) only. Create the Next.js app with the stack in the spec, copy lint, tsconfig, and test conventions from github.com/ed1017/people-analytics-ai, add a placeholder Overview page, and add the npm scripts lint, typecheck, test, and score (stub). Stop when all checks pass.
