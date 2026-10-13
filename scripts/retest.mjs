// Test-retest check: npm run retest [-- --again]
//
// Re-scores the first 50 tasks of the validation sample (stratified, see
// lib/validation/metrics.mjs) with the same prompt and model settings as scoring, and
// stores the second-pass labels in fow.retest_scores. /methodology reports how many
// kept their label. These rows are separate from fow.scoring_runs, so the views never
// read them. Runs from a laptop (.env.local) or the "Retest scores" GitHub Action.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { costUsd, makeBatches, readPrices, scoreBatch } from "../lib/scoring/batch.mjs";
import { loadPrompt } from "../lib/scoring/rubric.mjs";
import { supabaseProjectUrl } from "../lib/scoring/supabase-url.mjs";
import { RETEST_SIZE, stabilitySummary } from "../lib/validation/metrics.mjs";

const { values: args } = parseArgs({ options: { again: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false } }, allowPositionals: false });

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the shell environment (GitHub Actions).
}

const log = (msg) => console.log(`[retest] ${msg}`);
const requireEnv = (...names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
};
const check = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

const main = async () => {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(supabaseProjectUrl(process.env.SUPABASE_URL), process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "fow" },
    auth: { persistSession: false },
  });

  const done = check(await db.from("retest_runs").select("retest_id").eq("status", "succeeded").limit(1), "read retest_runs");
  if (done.length && !args.again) {
    log("a retest already exists; nothing to do (pass --again to repeat it)");
    return;
  }

  const sample = check(
    await db.from("validation_sample").select("run_id, task_id, position").lte("position", RETEST_SIZE).order("position"),
    "read validation_sample",
  );
  if (sample.length < RETEST_SIZE) throw new Error(`The validation sample has ${sample.length} tasks; draw it in /admin/review first.`);
  const ids = sample.map((s) => s.task_id);
  const [tasks, originals] = await Promise.all([
    db.from("task_statements").select("task_id, onetsoc_code, task_text").in("task_id", ids).then((r) => check(r, "read task_statements")),
    db.from("task_exposure_scores").select("run_id, task_id, label").in("task_id", ids).then((r) => check(r, "read task_exposure_scores")),
  ]);
  const original = new Map();
  for (const s of sample) original.set(s.task_id, originals.find((o) => o.run_id === s.run_id && o.task_id === s.task_id)?.label);

  const codes = [...new Set(tasks.map((t) => t.onetsoc_code))];
  const jobs = check(await db.from("dataset_jobs").select("title, onetsoc_code").in("onetsoc_code", codes), "read dataset_jobs");
  const titlesByCode = new Map();
  for (const j of jobs) titlesByCode.set(j.onetsoc_code, [...new Set([...(titlesByCode.get(j.onetsoc_code) ?? []), j.title])]);
  const batches = makeBatches(tasks.map((t) => ({ ...t, task_id: Number(t.task_id) })), titlesByCode);
  log(`${tasks.length} tasks in ${batches.length} batches`);
  if (args["dry-run"]) {
    log("dry run: stopping before any model calls");
    return;
  }

  requireEnv("OPENAI_API_KEY", "OPENAI_MODEL");
  const prices = readPrices(process.env);
  const model = process.env.OPENAI_MODEL;
  const prompt = await loadPrompt();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const [run] = check(await db.from("retest_runs").insert({ model, prompt_sha: prompt.sha }).select("retest_id"), "create retest run");

  const usage = { input_tokens: 0, output_tokens: 0 };
  const settings = { temperature: true };
  const second = new Map();
  let failure = null;
  try {
    for (const batch of batches) {
      const scores = await scoreBatch({ client, model, prompt: prompt.text, batch, settings, usage, log });
      check(
        await db.from("retest_scores").insert(scores.map((s) => ({ retest_id: run.retest_id, task_id: s.task_id, label: s.label, confidence: s.confidence }))),
        "write retest_scores",
      );
      for (const s of scores) second.set(s.task_id, s.label);
      log(`${second.size}/${tasks.length} tasks re-scored`);
    }
  } catch (err) {
    failure = err;
  }
  const cost = costUsd(usage, prices);
  check(
    await db
      .from("retest_runs")
      .update({
        status: failure ? "failed" : "succeeded",
        tasks_scored: second.size,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: cost,
        error: failure ? String(failure.message).slice(0, 2000) : null,
        finished_at: new Date().toISOString(),
      })
      .eq("retest_id", run.retest_id),
    "finish retest run",
  );
  if (failure) throw failure;
  const r = stabilitySummary(original, second);
  log(`stability ${r.same}/${r.tasks} same label, kappa ${r.kappa === null ? "n/a" : r.kappa.toFixed(2)}, $${cost.toFixed(4)}`);
};

main().catch((err) => {
  console.error(`[retest] ${err.message}`);
  process.exitCode = 1;
});
