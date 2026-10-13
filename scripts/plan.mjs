// Action planner: npm run plan -- --dataset <id> [--dry-run] [--verify-only]
//
// 1. Read the fow views the planner may cite.
// 2. Build each function's facts, courses, and redeployment targets (functions under
//    10 people get no plan).
// 3. Ask OPENAI_MODEL for one recommendation per function; validate it with zod
//    (at least two cited facts, every number in the text traced to them).
// 4. Insert the recommendations as one batch in fow.action_recommendations. Older
//    batches are kept; screens show the newest.
// 5. Re-read the batch and the views and check every recommendation cites at least two
//    data points that exist in the views with the value it quoted (milestone 6 check).
//    --verify-only runs just this step on the newest batch.
//
// Runs from a laptop (.env.local) or the "Plan actions" GitHub Action, never in Vercel.
// Writes to fow.action_recommendations only.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { checkRecommendation, MIN_METRIC_EVIDENCE } from "../lib/actions/evidence.mjs";
import { PLANNER_VIEWS, buildFunctionFacts, planningScope, rowsByView } from "../lib/actions/facts.mjs";
import { planFunction } from "../lib/actions/generate.mjs";
import { loadPrompt, toRecommendationRow } from "../lib/actions/plan.mjs";
import { costUsd, readPrices } from "../lib/scoring/batch.mjs";
import { supabaseProjectUrl } from "../lib/scoring/supabase-url.mjs";

const { values: args } = parseArgs({
  options: {
    dataset: { type: "string", default: "builtin" },
    "dry-run": { type: "boolean", default: false },
    "verify-only": { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
  allowPositionals: false,
});

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the shell environment (GitHub Actions).
}

const log = (msg) => console.log(`[plan] ${msg}`);

const requireEnv = (...names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
};

const check = ({ data, error }, what) => {
  if (error?.code === "PGRST106") {
    throw new Error(`${what}: the fow schema is not exposed. In Supabase, add fow under Settings > Data API > Exposed schemas.`);
  }
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

const DATASET_VIEWS = new Set(["v_function_exposure", "v_exposure_adoption", "v_job_exposure", "v_function_readiness", "v_function_skill_gaps", "v_redeployment_paths"]);

const readViews = async (db, datasetId) => {
  const entries = await Promise.all(
    Object.entries(PLANNER_VIEWS).map(async ([prop, view]) => {
      let query = db.from(view).select("*");
      if (DATASET_VIEWS.has(view)) query = query.eq("dataset_id", datasetId);
      return [prop, check(await query.limit(5000), `read ${view}`)];
    })
  );
  return /** @type {import("../lib/actions/facts.mjs").PlannerRows} */ (Object.fromEntries(entries));
};

/** Check the newest batch against the views; throws if any recommendation falls short. */
const verify = async (db, datasetId) => {
  const recs = check(
    await db
      .from("action_recommendations")
      .select("scope_key, move, evidence, created_at")
      .eq("dataset_id", datasetId)
      .order("created_at", { ascending: false })
      .limit(200),
    "read action_recommendations"
  );
  if (!recs.length) throw new Error(`no recommendations for ${datasetId}`);
  const batch = recs.filter((r) => r.created_at === recs[0].created_at);
  const views = rowsByView(await readViews(db, datasetId));
  let failures = 0;
  for (const rec of batch.sort((a, b) => a.scope_key.localeCompare(b.scope_key))) {
    const result = checkRecommendation(rec, views);
    const ok = result.passes && result.metricsMatching >= MIN_METRIC_EVIDENCE;
    if (!ok) failures += 1;
    log(
      `${ok ? "ok  " : "FAIL"} ${rec.scope_key} (${rec.move}): ${result.metricsMatching} of ${result.metrics} cited data points match the views` +
        (result.items.length > result.metrics ? `, plus ${result.items.length - result.metrics} courses or targets` : "")
    );
  }
  if (failures) throw new Error(`${failures} of ${batch.length} recommendations cite fewer than ${MIN_METRIC_EVIDENCE} data points that exist in the views`);
  log(`check passed: all ${batch.length} recommendations (batch ${batch[0].created_at}) cite at least ${MIN_METRIC_EVIDENCE} data points that exist in the views`);
};

const main = async () => {
  const datasetId = args.dataset;
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(supabaseProjectUrl(process.env.SUPABASE_URL.trim()), process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
    db: { schema: "fow" },
    auth: { persistSession: false },
  });

  if (args["verify-only"]) return verify(db, datasetId);

  // 1-2. Facts per function -----------------------------------------------------------
  const rows = await readViews(db, datasetId);
  const { planned, skipped } = planningScope(rows.functionExposure);
  if (!planned.length) throw new Error(`dataset ${datasetId} has no scored functions to plan`);
  if (skipped.length) log(`no plan for ${skipped.join(", ")}: fewer than 10 people`);
  const offered = planned.map((fn) => buildFunctionFacts(rows, fn));
  for (const o of offered) log(`${o.function}: ${o.facts.length} facts, ${o.courses.length} courses, ${o.targets.length} targets`);
  if (args["dry-run"]) {
    log("dry run: stopping before any model calls");
    return;
  }

  // 3. One model call per function -----------------------------------------------------
  requireEnv("OPENAI_API_KEY", "OPENAI_MODEL");
  const prices = readPrices(process.env);
  const model = process.env.OPENAI_MODEL.trim();
  const prompt = await loadPrompt();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });
  const [latestRun] = check(
    await db
      .from("scoring_runs")
      .select("run_id")
      .eq("status", "succeeded")
      .order("finished_at", { ascending: false })
      .limit(1),
    "read scoring_runs"
  );
  log(`${model}, prompt ${prompt.sha.slice(0, 12)}, exposure from scoring run ${latestRun?.run_id ?? "none"}`);

  const usage = { input_tokens: 0, output_tokens: 0 };
  const settings = { temperature: true };
  const createdAt = new Date().toISOString();
  const results = new Array(offered.length);
  let next = 0;
  const worker = async () => {
    while (next < offered.length) {
      const i = next++;
      const answer = await planFunction({ client, model, prompt: prompt.text, offered: offered[i], settings, usage, log });
      results[i] = toRecommendationRow({
        datasetId,
        offered: offered[i],
        answer,
        model,
        runId: latestRun?.run_id ?? null,
        promptSha: prompt.sha,
        createdAt,
      });
      log(`${offered[i].function}: ${answer.move}, ${answer.evidence_ids.length} data points cited`);
    }
  };
  const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 4));
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    log(
      `${usage.input_tokens} input + ${usage.output_tokens} output tokens, $${costUsd(usage, prices).toFixed(4)}` +
        (settings.temperature ? ", temperature 0" : ", model default temperature")
    );
  }

  // 4. Store the batch; nothing is written unless every function succeeded ----------------
  check(await db.from("action_recommendations").insert(results), "write action_recommendations");
  log(`wrote ${results.length} recommendations for ${datasetId}`);

  // 5. Acceptance check -------------------------------------------------------------
  await verify(db, datasetId);
};

main().catch((err) => {
  console.error(`[plan] ${err.message}`);
  process.exitCode = 1;
});
