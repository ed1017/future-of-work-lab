import { createClient } from "@supabase/supabase-js";
import { latestScores } from "@/lib/overview/metrics.mjs";
import type {
  AdoptionRow,
  FunctionExposureRow,
  JobExposureRow,
  OverviewData,
  RegisterRow,
} from "@/lib/overview/metrics.mjs";
import { supabaseProjectUrl } from "@/lib/scoring/supabase-url.mjs";

// Server-only reads of the fow aggregate views with the service role key. Nothing in
// this file runs in the browser; pages pass only aggregates to client components.

export const DEFAULT_DATASET = "builtin";

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

/** Why a read failed, as text safe to show: never includes the URL or key. */
export function describeLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return `${message}${cause}`.slice(0, 400);
}

export type ActionRow = { scope_key: string; move: string; text: string };

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
      .select("scope_key, move, text")
      .eq("dataset_id", datasetId)
      .order("created_at", { ascending: false })
      .limit(4),
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
