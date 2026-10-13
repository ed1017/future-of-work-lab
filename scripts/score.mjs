// Exposure scoring pipeline: npm run score -- --dataset <id> [--dry-run]
//
// 1. Load tasks: import O*NET Task Statements and Task Ratings into fow.task_statements
//    for every O*NET code in the dataset that has no tasks yet.
// 2. Build job tasks: rebuild fow.job_tasks for the dataset (time shares sum to 1 per job).
// 3. Score: send tasks not yet scored under this rubric version to OPENAI_MODEL in
//    batches of 25 and validate each response with zod.
// 4. Record the run in fow.scoring_runs with its prompt hash, token counts, and cost.
//
// Runs from a laptop (.env.local) or the "Score exposure" GitHub Action, never in Vercel.
// Writes to the fow schema only.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify, parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { costUsd, makeBatches, readPrices, scoreBatch } from "../lib/scoring/batch.mjs";
import { DEFAULT_ONET_RELEASE, buildTaskStatements, onetZipUrl } from "../lib/scoring/onet.mjs";
import { RUBRIC_VERSION, loadPrompt } from "../lib/scoring/rubric.mjs";
import { supabaseProjectUrl } from "../lib/scoring/supabase-url.mjs";
import { buildJobTasks } from "../lib/scoring/time-share.mjs";

const { values: args } = parseArgs({
  options: {
    dataset: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "onet-release": { type: "string", default: DEFAULT_ONET_RELEASE },
    "onet-dir": { type: "string" },
    reimport: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
  allowPositionals: false,
});

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the shell environment (GitHub Actions).
}

const log = (msg) => console.log(`[score] ${msg}`);

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

/** Read every row of a query, past PostgREST's per-request row limit. */
const selectAll = async (build, what, page = 1000) => {
  const rows = [];
  for (let from = 0; ; from += page) {
    const data = check(await build().range(from, from + page - 1), what);
    rows.push(...data);
    if (data.length < page) return rows;
  }
};

const inChunks = async (rows, size, fn) => {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
};

const readOnetFiles = async () => {
  const names = ["Task Statements.txt", "Task Ratings.txt"];
  if (args["onet-dir"]) {
    return Promise.all(names.map((n) => readFile(join(args["onet-dir"], n), "utf8")));
  }
  const url = onetZipUrl(args["onet-release"]);
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`O*NET download failed: ${res.status} ${res.statusText}`);
  const dir = await mkdtemp(join(tmpdir(), "onet-"));
  try {
    const zip = join(dir, "onet.zip");
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    const unzip = promisify(execFile);
    return await Promise.all(
      names.map(async (n) => (await unzip("unzip", ["-p", zip, `*/${n}`], { maxBuffer: 256 * 1024 * 1024 })).stdout)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const main = async () => {
  const datasetId = args.dataset;
  if (!datasetId) throw new Error("Usage: npm run score -- --dataset <id> [--dry-run]");
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(supabaseProjectUrl(process.env.SUPABASE_URL), process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "fow" },
    auth: { persistSession: false },
  });

  const [dataset] = check(
    await db.from("datasets").select("dataset_id, name").eq("dataset_id", datasetId),
    "read datasets"
  );
  if (!dataset) throw new Error(`No dataset ${datasetId} in fow.datasets`);

  // 1. Load tasks -------------------------------------------------------------
  const jobs = await selectAll(
    () => db.from("dataset_jobs").select("job_key, title, onetsoc_code").eq("dataset_id", datasetId).order("job_key"),
    "read dataset_jobs"
  );
  const codes = [...new Set(jobs.map((j) => j.onetsoc_code).filter(Boolean))].sort();
  log(`${dataset.name}: ${jobs.length} jobs across ${codes.length} O*NET occupations`);

  const loadTasks = () =>
    selectAll(
      () =>
        db
          .from("task_statements")
          .select("task_id, onetsoc_code, task_text, importance, frequency")
          .in("onetsoc_code", codes)
          .eq("source", "onet")
          .order("task_id"),
      "read task_statements"
    );
  let tasks = await loadTasks();
  const loaded = new Set(tasks.map((t) => t.onetsoc_code));
  const toImport = args.reimport ? codes : codes.filter((c) => !loaded.has(c));
  if (toImport.length) {
    log(`importing O*NET ${args["onet-release"]} tasks for ${toImport.length} occupations`);
    const [statements, ratings] = await readOnetFiles();
    const rows = buildTaskStatements({ statements, ratings, codes: toImport });
    const found = new Set(rows.map((r) => r.onetsoc_code));
    const notFound = toImport.filter((c) => !found.has(c));
    if (notFound.length) log(`warning: O*NET has no tasks for ${notFound.join(", ")}`);
    await inChunks(rows, 500, async (chunk) =>
      check(await db.from("task_statements").upsert(chunk, { onConflict: "task_id" }), "write task_statements")
    );
    log(`loaded ${rows.length} task statements`);
    tasks = await loadTasks();
  }

  // 2. Build job tasks ----------------------------------------------------------
  const { rows: jobTasks, unmapped } = buildJobTasks(datasetId, jobs, tasks);
  if (unmapped.length) log(`warning: ${unmapped.length} jobs have no O*NET tasks: ${unmapped.join(", ")}`);
  check(await db.from("job_tasks").delete().eq("dataset_id", datasetId), "clear job_tasks");
  await inChunks(jobTasks, 500, async (chunk) =>
    check(await db.from("job_tasks").insert(chunk), "write job_tasks")
  );
  log(`built ${jobTasks.length} job tasks for ${jobs.length - unmapped.length} jobs`);

  // 3. Score tasks not yet scored under this rubric version -------------------------
  const runs = check(
    await db.from("scoring_runs").select("run_id").eq("status", "succeeded").eq("rubric_version", RUBRIC_VERSION),
    "read scoring_runs"
  );
  const cached = new Set();
  for (const { run_id } of runs) {
    const scored = await selectAll(
      () => db.from("task_exposure_scores").select("task_id").eq("run_id", run_id).order("task_id"),
      "read task_exposure_scores"
    );
    for (const s of scored) cached.add(Number(s.task_id));
  }
  const needed = new Set(jobTasks.map((r) => r.task_id).filter((id) => !cached.has(id)));
  const titlesByCode = new Map();
  for (const j of jobs) {
    if (!j.onetsoc_code) continue;
    titlesByCode.set(j.onetsoc_code, [...(titlesByCode.get(j.onetsoc_code) ?? []), j.title]);
  }
  const batches = makeBatches(
    tasks.filter((t) => needed.has(Number(t.task_id))).map((t) => ({ ...t, task_id: Number(t.task_id) })),
    titlesByCode
  );
  log(`${needed.size} tasks to score in ${batches.length} batches; ${cached.size} already scored under rubric ${RUBRIC_VERSION}`);
  if (needed.size === 0) {
    log("every task already has a score under this rubric; no model calls made");
    return;
  }
  if (args["dry-run"]) {
    log("dry run: stopping before any model calls");
    return;
  }

  requireEnv("OPENAI_API_KEY", "OPENAI_MODEL");
  const prices = readPrices(process.env);
  const model = process.env.OPENAI_MODEL;
  const prompt = await loadPrompt();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const [run] = check(
    await db
      .from("scoring_runs")
      .insert({ dataset_id: datasetId, model, rubric_version: RUBRIC_VERSION, prompt_sha: prompt.sha, status: "running" })
      .select("run_id"),
    "create scoring run"
  );
  log(`run ${run.run_id}: ${model}, rubric ${RUBRIC_VERSION}, prompt ${prompt.sha.slice(0, 12)}`);

  // 4. Run the batches and record the run ---------------------------------------
  const usage = { input_tokens: 0, output_tokens: 0 };
  const settings = { temperature: true };
  let scored = 0;
  let failure = null;
  let next = 0;
  const worker = async () => {
    while (!failure && next < batches.length) {
      const batch = batches[next++];
      try {
        const scores = await scoreBatch({ client, model, prompt: prompt.text, batch, settings, usage, log });
        check(
          await db.from("task_exposure_scores").insert(scores.map((s) => ({ run_id: run.run_id, ...s }))),
          "write task_exposure_scores"
        );
        scored += scores.length;
        log(`${scored}/${needed.size} tasks scored`);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 4));
  await Promise.all(Array.from({ length: concurrency }, worker));

  const cost = costUsd(usage, prices);
  check(
    await db
      .from("scoring_runs")
      .update({
        status: failure ? "failed" : "succeeded",
        tasks_scored: scored,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: cost,
        error: failure ? String(failure.message).slice(0, 2000) : null,
        finished_at: new Date().toISOString(),
      })
      .eq("run_id", run.run_id),
    "finish scoring run"
  );
  log(
    `run ${failure ? "failed" : "succeeded"}: ${scored} tasks, ${usage.input_tokens} input + ${usage.output_tokens} output tokens, $${cost.toFixed(4)}` +
      (settings.temperature ? ", temperature 0" : ", model default temperature")
  );
  if (failure) throw failure;
};

main().catch((err) => {
  console.error(`[score] ${err.message}`);
  process.exitCode = 1;
});
