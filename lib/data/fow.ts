import { createClient } from "@supabase/supabase-js";
import { latestScores } from "@/lib/overview/metrics.mjs";
import type {
  AdoptionRow,
  FunctionExposureRow,
  JobExposureRow,
  OverviewData,
  RegisterRow,
} from "@/lib/overview/metrics.mjs";
import { drawSample, stabilitySummary, validationSummary } from "@/lib/validation/metrics.mjs";
import { supabaseProjectUrl } from "@/lib/scoring/supabase-url.mjs";
import { PLANNER_VIEWS } from "@/lib/actions/facts.mjs";
import type { PlannerRows } from "@/lib/actions/facts.mjs";
import type { RecommendationRow } from "@/lib/actions/screen.mjs";

// Server-only reads of the fow aggregate views with the service role key. Nothing in
// this file runs in the browser; pages pass only aggregates to client components.

export const DEFAULT_DATASET = "builtin";

function client() {
  // Trim: a pasted env value with a trailing newline or space is an invalid header value.
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. Add them as environment variables (Vercel project settings, or .env.local locally).",
    );
  }
  return createClient(supabaseProjectUrl(url), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "fow" },
  });
}

function check<T>(result: { data: unknown; error: { code?: string; message: string } | null }, what: string): T {
  if (result.error?.code === "PGRST106") {
    throw new Error(`${what}: the fow schema is not exposed. Add fow under Supabase Settings > Data API > Exposed schemas.`);
  }
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? []) as T;
}

type RunStamp = { status: string; finished_at: string | null; started_at: string };

/**
 * Why a read failed, as text safe to show. Error messages can echo request values, so
 * anything shaped like a key or token, and the configured secrets themselves, are redacted.
 */
export function describeLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  let text = `${message}${cause}`;
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_URL, process.env.OPENAI_API_KEY]) {
    const value = secret?.trim();
    if (value && value.length >= 8) text = text.split(value).join("[redacted]");
  }
  text = text
    .replace(/sb_(?:secret|publishable)_[\w-]+/g, "[redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]")
    .replace(/sk-[\w-]{8,}/g, "[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]");
  return text.slice(0, 400);
}

export type ActionRow = { scope_key: string; move: string; text: string; created_at: string };

export type DatasetInfo = { name: string; headcount: number | null; functions: number };

export async function getOverviewData(datasetId = DEFAULT_DATASET) {
  const db = client();
  const [functionExposure, adoption, jobs, register, dataset, actions] = await Promise.all([
    db.from("v_function_exposure").select("*").eq("dataset_id", datasetId),
    db.from("v_exposure_adoption").select("*").eq("dataset_id", datasetId),
    db.from("v_job_exposure").select("*").eq("dataset_id", datasetId),
    db.from("v_register").select("*"),
    db.from("datasets").select("name").eq("dataset_id", datasetId).maybeSingle(),
    db
      .from("action_recommendations")
      .select("scope_key, move, text, created_at")
      .eq("dataset_id", datasetId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const data: OverviewData = {
    functionExposure: check<FunctionExposureRow[]>(functionExposure, "v_function_exposure"),
    adoption: check<AdoptionRow[]>(adoption, "v_exposure_adoption"),
    jobs: check<JobExposureRow[]>(jobs, "v_job_exposure"),
    register: check<RegisterRow[]>(register, "v_register"),
  };
  const total = data.functionExposure.find((r) => r.is_total);
  const info: DatasetInfo = {
    name: check<{ name: string } | null>(dataset, "datasets")?.name ?? datasetId,
    headcount: total?.headcount ?? null,
    functions: data.functionExposure.filter((r) => !r.is_total).length,
  };
  return { data, info, actions: check<ActionRow[]>(actions, "action_recommendations") };
}

// PostgREST returns a many-to-one embed as an object; untyped supabase-js says array.
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** Tasks for one job with their latest succeeded scores (O*NET task text is not employee data). */
export async function getJobTasks(datasetId: string, jobKey: string) {
  const db = client();
  const jobTasks = check<{ task_id: number; time_share: number; task_statements: { task_text: string } | { task_text: string }[] | null }[]>(
    await db
      .from("job_tasks")
      .select("task_id, time_share, task_statements(task_text)")
      .eq("dataset_id", datasetId)
      .eq("job_key", jobKey),
    "job_tasks",
  );
  const ids = jobTasks.map((t) => t.task_id);
  const scoreRows = ids.length
    ? check<
        {
          task_id: number;
          label: string;
          exposure: number;
          confidence: string;
          rationale: string;
          scoring_runs: RunStamp | RunStamp[] | null;
        }[]
      >(
        await db
          .from("task_exposure_scores")
          .select("task_id, label, exposure, confidence, rationale, scoring_runs(status, finished_at, started_at)")
          .in("task_id", ids),
        "task_exposure_scores",
      )
    : [];
  const scores = latestScores(
    scoreRows.flatMap(({ scoring_runs, ...row }) => {
      const run = one(scoring_runs);
      return run ? [{ ...row, run }] : [];
    }),
  );
  return {
    jobTasks: jobTasks.map((t) => ({
      task_id: t.task_id,
      time_share: t.time_share,
      task_text: one(t.task_statements)?.task_text ?? "",
    })),
    scores,
  };
}

// Adoption and governance ------------------------------------------------------

export type ManagerTeamRow = {
  function_name: string;
  team_number: number;
  headcount: number;
  licensed_employees: number;
  weekly_active_users: number;
  licensed_rate: number;
  weekly_active_rate: number;
};

export type ToolMixRow = {
  tool_id: string;
  name: string;
  category: string;
  approved: boolean;
  licenses: number;
  week_start: string;
  suppressed: boolean;
  weekly_active_users: number | null;
  sessions: number | null;
};

export type PulseRow = {
  level: "company" | "function";
  function_name: string | null;
  question_code: string;
  question_text: string;
  response_date: string;
  suppressed: boolean;
  respondents: number | null;
  favorable_rate: number | null;
  mean_score: number | null;
};

export async function getAdoptionData() {
  const db = client();
  const [adoption, managers, tools, pulse] = await Promise.all([
    db.from("v_exposure_adoption").select("*").eq("dataset_id", DEFAULT_DATASET),
    db.from("v_adoption_manager").select("*"),
    db.from("v_tool_mix").select("*"),
    db.from("v_pulse_sentiment").select("*"),
  ]);
  return {
    adoption: check<AdoptionRow[]>(adoption, "v_exposure_adoption"),
    managers: check<ManagerTeamRow[]>(managers, "v_adoption_manager"),
    tools: check<ToolMixRow[]>(tools, "v_tool_mix"),
    pulse: check<PulseRow[]>(pulse, "v_pulse_sentiment"),
  };
}

export type ToolOption = { tool_id: string; name: string };

export type AssessmentRow = {
  assessment_id: string;
  use_case_id: string;
  framework: string;
  tier: string;
  rationale: string;
  review_state: string;
  assessed_on: string;
  bias_audit_date: string | null;
  next_review_date: string | null;
};

export type UseCaseDetail = {
  use_case_id: string;
  name: string;
  hr_process: string;
  tool_id: string | null;
  decision_impact: string;
  owner: string;
  human_in_loop: boolean;
  status: string;
  description: string | null;
};

/** The register is not employee data, so every visitor reads it. */
export async function getRegister() {
  const db = client();
  return check<RegisterRow[]>(await db.from("v_register").select("*"), "v_register");
}

/** Editing context. Callers must have confirmed the admin session first. */
export async function getEditContext() {
  const db = client();
  const [tools, useCases, assessments] = await Promise.all([
    db.from("ai_tools").select("tool_id, name").order("name"),
    db
      .from("ai_use_cases")
      .select("use_case_id, name, hr_process, tool_id, decision_impact, owner, human_in_loop, status, description"),
    db
      .from("risk_assessments")
      .select("assessment_id, use_case_id, framework, tier, rationale, review_state, assessed_on, bias_audit_date, next_review_date")
      .order("assessed_on", { ascending: false }),
  ]);
  return {
    tools: check<ToolOption[]>(tools, "ai_tools"),
    useCases: check<UseCaseDetail[]>(useCases, "ai_use_cases"),
    assessments: check<AssessmentRow[]>(assessments, "risk_assessments"),
  };
}

type UseCaseInput = Omit<UseCaseDetail, "use_case_id">;
type AssessmentInput = Omit<AssessmentRow, "assessment_id">;

function written(result: { error: { message: string } | null }, what: string) {
  // Only the table name leaves this function; the database message stays out of the UI.
  if (result.error) throw new Error(`${what} write failed`);
}

export async function upsertUseCase(id: string | null, input: UseCaseInput) {
  const db = client();
  const row = { ...input, updated_at: new Date().toISOString() };
  written(id ? await db.from("ai_use_cases").update(row).eq("use_case_id", id) : await db.from("ai_use_cases").insert(row), "ai_use_cases");
}

export async function insertAssessment(input: AssessmentInput) {
  const db = client();
  written(
    await db.from("risk_assessments").upsert(input, { onConflict: "use_case_id,framework,assessed_on" }),
    "risk_assessments",
  );
}

export async function deleteUseCase(id: string) {
  written(await client().from("ai_use_cases").delete().eq("use_case_id", id), "ai_use_cases");
}

// Action plan -------------------------------------------------------------------

/** Views that hold one dataset's rows; the others are company-wide. */
const DATASET_VIEWS = new Set([
  "v_function_exposure",
  "v_exposure_adoption",
  "v_job_exposure",
  "v_function_readiness",
  "v_function_skill_gaps",
  "v_redeployment_paths",
]);

/**
 * The newest recommendations plus every view they may cite, so the screen can check
 * each cited data point against the current rows. All of these are aggregate views.
 */
export async function getActionPlanData(datasetId = DEFAULT_DATASET) {
  const db = client();
  const [recommendations, ...views] = await Promise.all([
    db
      .from("action_recommendations")
      .select("scope_key, move, text, evidence, model, prompt_sha, run_id, created_at")
      .eq("dataset_id", datasetId)
      .order("created_at", { ascending: false })
      .limit(200),
    ...Object.values(PLANNER_VIEWS).map((view) => {
      const query = db.from(view).select("*");
      return DATASET_VIEWS.has(view) ? query.eq("dataset_id", datasetId) : query;
    }),
  ]);
  const rows = Object.fromEntries(
    Object.entries(PLANNER_VIEWS).map(([prop, view], i) => [prop, check<Record<string, unknown>[]>(views[i], view)]),
  ) as unknown as PlannerRows;
  return {
    recommendations: check<RecommendationRow[]>(recommendations, "action_recommendations"),
    rows,
  };
}

// Methodology and validation -------------------------------------------------------

export type ModelLabel = "automate" | "augment" | "unaffected";
export type SampleRow = { run_id: string; task_id: number; stratum: ModelLabel; stratum_size: number; position: number };
export type ReviewRow = { run_id: string; task_id: number; reviewer: string; agrees: boolean; override_label: ModelLabel | null; note: string | null; reviewed_at: string };
export type RunSummary = {
  run_id: string;
  model: string;
  rubric_version: string;
  prompt_sha: string;
  status: string;
  tasks_scored: number;
  cost_usd: number | null;
  started_at: string;
};

/** True when a read failed only because the milestone 7 tables are not in the database yet. */
const tableMissing = (message: string) => /PGRST205|42P01|schema cache|does not exist/i.test(message);

async function readAll<T>(build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> }, what: string) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check<T[]>(await build().range(from, from + 999), what);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

/** Latest succeeded score per task (the one the views use), with its run id. */
async function latestTaskScores() {
  const rows = await readAll<{
    run_id: string;
    task_id: number;
    label: ModelLabel;
    exposure: number;
    confidence: string;
    rationale: string;
    scoring_runs: RunStamp | RunStamp[] | null;
  }>(
    () =>
      client()
        .from("task_exposure_scores")
        .select("run_id, task_id, label, exposure, confidence, rationale, scoring_runs(status, finished_at, started_at)")
        .order("task_id"),
    "task_exposure_scores",
  );
  return latestScores(
    rows.flatMap(({ scoring_runs, ...row }) => {
      const run = one(scoring_runs);
      return run ? [{ ...row, run }] : [];
    }),
  );
}

async function readSampleAndReviews() {
  const db = client();
  const sampleResult = await db.from("validation_sample").select("run_id, task_id, stratum, stratum_size, position").order("position");
  if (sampleResult.error && tableMissing(sampleResult.error.message)) return null;
  const sample = check<SampleRow[]>(sampleResult, "validation_sample");
  const reviews = sample.length ? check<ReviewRow[]>(await db.from("score_reviews").select("*"), "score_reviews") : [];
  const bySampleKey = new Set(sample.map((s) => `${s.run_id}:${s.task_id}`));
  return { sample, reviews: reviews.filter((r) => bySampleKey.has(`${r.run_id}:${r.task_id}`)) };
}

/** Model labels for the sample tasks: the exact score row each sample entry points at. */
async function sampleModelLabels(sample: SampleRow[]) {
  if (!sample.length) return new Map<number, ModelLabel>();
  const rows = check<{ run_id: string; task_id: number; label: ModelLabel }[]>(
    await client().from("task_exposure_scores").select("run_id, task_id, label").in("task_id", sample.map((s) => s.task_id)),
    "task_exposure_scores",
  );
  const key = new Map(rows.map((r) => [`${r.run_id}:${r.task_id}`, r.label]));
  return new Map(sample.flatMap((s) => (key.has(`${s.run_id}:${s.task_id}`) ? [[s.task_id, key.get(`${s.run_id}:${s.task_id}`)!] as const] : [])));
}

/** Public: aggregates only (counts, rates, kappa). Never reviewer identity, notes, or per-task labels. */
export async function getMethodologyData() {
  const db = client();
  const runs = check<RunSummary[]>(
    await db
      .from("scoring_runs")
      .select("run_id, model, rubric_version, prompt_sha, status, tasks_scored, cost_usd, started_at")
      .order("started_at", { ascending: false }),
    "scoring_runs",
  );
  const loaded = await readSampleAndReviews();
  if (!loaded) return { runs, validation: null, stability: null, setUp: false };
  const modelLabels = await sampleModelLabels(loaded.sample);
  const humanReviews = new Map<number, ReviewRow>();
  for (const r of [...loaded.reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))) humanReviews.set(r.task_id, r);
  const validation = loaded.sample.length ? validationSummary(loaded.sample, modelLabels, humanReviews) : null;

  const retests = check<{ retest_id: string; status: string; tasks_scored: number; cost_usd: number | null; finished_at: string | null }[]>(
    await db.from("retest_runs").select("retest_id, status, tasks_scored, cost_usd, finished_at").eq("status", "succeeded").order("started_at", { ascending: false }).limit(1),
    "retest_runs",
  );
  let stability = null;
  if (retests[0]) {
    const second = check<{ task_id: number; label: ModelLabel }[]>(
      await db.from("retest_scores").select("task_id, label").eq("retest_id", retests[0].retest_id),
      "retest_scores",
    );
    stability = { ...stabilitySummary(modelLabels, new Map(second.map((r) => [r.task_id, r.label]))), cost_usd: retests[0].cost_usd, finished_at: retests[0].finished_at };
  }
  return { runs, validation, stability, setUp: true };
}

export type ReviewTask = {
  task_id: number;
  position: number;
  stratum: ModelLabel;
  task_text: string;
  task_type: string | null;
  importance: number | null;
  occupation_titles: string[];
  reviewed: boolean;
  /** The reviewer's own label, once given. The model's label is never sent to the reviewer's screen. */
  my_label: ModelLabel | null;
  note: string | null;
};

/** Admin only. Callers must have confirmed the admin session first. */
export async function getReviewQueue(reviewer: string) {
  const loaded = await readSampleAndReviews();
  if (!loaded) return { setUp: false as const, sample: [] as ReviewTask[], eligible: 0 };
  const db = client();
  if (!loaded.sample.length) {
    const scores = await latestTaskScores();
    return { setUp: true as const, sample: [] as ReviewTask[], eligible: scores.size };
  }
  const ids = loaded.sample.map((s) => s.task_id);
  const [tasks, modelLabels] = await Promise.all([
    check<{ task_id: number; onetsoc_code: string | null; task_text: string; task_type: string | null; importance: number | null }[]>(
      await db.from("task_statements").select("task_id, onetsoc_code, task_text, task_type, importance").in("task_id", ids),
      "task_statements",
    ),
    sampleModelLabels(loaded.sample),
  ]);
  const codes = [...new Set(tasks.flatMap((t) => (t.onetsoc_code ? [t.onetsoc_code] : [])))];
  const titles = codes.length
    ? check<{ onetsoc_code: string; title: string }[]>(await db.from("dataset_jobs").select("onetsoc_code, title").in("onetsoc_code", codes), "dataset_jobs")
    : [];
  const byTask = new Map(tasks.map((t) => [t.task_id, t]));
  const mine = new Map(loaded.reviews.filter((r) => r.reviewer === reviewer).map((r) => [r.task_id, r]));
  const sample = loaded.sample.map((s): ReviewTask => {
    const t = byTask.get(s.task_id);
    const r = mine.get(s.task_id);
    const model = modelLabels.get(s.task_id);
    return {
      task_id: s.task_id,
      position: s.position,
      stratum: s.stratum,
      task_text: t?.task_text ?? "",
      task_type: t?.task_type ?? null,
      importance: t?.importance == null ? null : Number(t.importance),
      occupation_titles: [...new Set(titles.filter((x) => x.onetsoc_code === t?.onetsoc_code).map((x) => x.title))],
      reviewed: Boolean(r),
      my_label: r && model ? (r.agrees ? model : r.override_label) : null,
      note: r?.note ?? null,
    };
  });
  return { setUp: true as const, sample, eligible: sample.length };
}

/** Draws the 100-task sample once. Does nothing if a sample already exists. Returns the number drawn. */
export async function drawValidationSample() {
  const db = client();
  const existing = check<{ task_id: number }[]>(await db.from("validation_sample").select("task_id").limit(1), "validation_sample");
  if (existing.length) return 0;
  const scores = [...(await latestTaskScores()).values()].map((s) => ({ run_id: (s as { run_id?: string }).run_id ?? "", task_id: s.task_id, label: s.label as ModelLabel }));
  const rows = drawSample(scores);
  written(await db.from("validation_sample").insert(rows), "validation_sample");
  return rows.length;
}

export async function saveReview(input: { task_id: number; reviewer: string; label: ModelLabel; note: string | null }) {
  const db = client();
  const sample = check<SampleRow[]>(
    await db.from("validation_sample").select("run_id, task_id, stratum, stratum_size, position").eq("task_id", input.task_id),
    "validation_sample",
  );
  if (!sample[0]) throw new Error("validation_sample: task not in the sample");
  const model = (await sampleModelLabels(sample)).get(input.task_id);
  if (!model) throw new Error("task_exposure_scores: score not found");
  const agrees = input.label === model;
  written(
    await db.from("score_reviews").upsert(
      {
        run_id: sample[0].run_id,
        task_id: input.task_id,
        reviewer: input.reviewer,
        agrees,
        override_label: agrees ? null : input.label,
        note: input.note,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "run_id,task_id,reviewer" },
    ),
    "score_reviews",
  );
}
