import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { costUsd, makeBatches, readPrices, scoreBatch } from "../lib/scoring/batch.mjs";
import { buildTaskStatements, onetZipUrl, parseTsv } from "../lib/scoring/onet.mjs";
import {
  EXPOSURE_BY_LABEL,
  RUBRIC_VERSION,
  batchResponseSchema,
  loadPrompt,
  taskScoreSchema,
} from "../lib/scoring/rubric.mjs";
import { buildJobTasks, jobExposure, timeShares, weightedRollup } from "../lib/scoring/time-share.mjs";

const valid = {
  task_id: 8823,
  label: "augment",
  exposure: 0.5,
  confidence: "medium",
  rationale: "AI drafts the first version of the report; the analyst still checks sources and decides what goes in.",
};

const issues = (value) => {
  const result = taskScoreSchema.safeParse(value);
  assert.equal(result.success, false);
  return result.error.issues.map((i) => i.message).join("; ");
};

// Model output ------------------------------------------------------------------------

test("The score schema accepts a well-formed score", () => {
  assert.equal(taskScoreSchema.safeParse(valid).success, true);
});

test("The score schema rejects a missing label", () => {
  const missing = { ...valid };
  delete missing.label;
  issues(missing);
});

test("The score schema rejects a label outside the rubric", () => {
  issues({ ...valid, label: "replace" });
});

test("The score schema rejects out-of-range exposure", () => {
  issues({ ...valid, exposure: 1.5 });
  issues({ ...valid, exposure: -0.1 });
});

test("The score schema rejects exposure that is not the label's rubric value", () => {
  assert.match(issues({ ...valid, exposure: 0.7 }), /rubric value/);
});

test("The score schema rejects rationales over 40 words", () => {
  assert.match(issues({ ...valid, rationale: Array(41).fill("word").join(" ") }), /40 words/);
  assert.equal(taskScoreSchema.safeParse({ ...valid, rationale: Array(40).fill("word").join(" ") }).success, true);
});

test("The score schema rejects an empty rationale and unknown confidence", () => {
  issues({ ...valid, rationale: "   " });
  issues({ ...valid, confidence: "certain" });
});

test("A batch response must score every requested task exactly once", () => {
  const schema = batchResponseSchema([1, 2]);
  const s = (task_id) => ({ ...valid, task_id });
  assert.equal(schema.safeParse({ scores: [s(1), s(2)] }).success, true);
  assert.equal(schema.safeParse({ scores: [s(1)] }).success, false);
  assert.equal(schema.safeParse({ scores: [s(1), s(2), s(3)] }).success, false);
  assert.equal(schema.safeParse({ scores: [s(1), s(1), s(2)] }).success, false);
});

test("The rubric prompt is stored in the repo and hashed", async () => {
  const prompt = await loadPrompt();
  assert.equal(RUBRIC_VERSION, "v1");
  assert.match(prompt.sha, /^[0-9a-f]{64}$/);
  for (const [label, value] of Object.entries(EXPOSURE_BY_LABEL)) {
    assert.match(prompt.text, new RegExp(`\\| ${label} \\|[^\\n]*\\| ${value.toFixed(1)} \\|`));
  }
  assert.match(prompt.text, /under 40 words/);
});

// O*NET import --------------------------------------------------------------------------

const statements = [
  "O*NET-SOC Code\tTask ID\tTask\tTask Type\tIncumbents Responding\tDate\tDomain Source",
  "15-1252.00\t101\tWrite code.\tCore\t50\t08/2024\tIncumbent",
  "15-1252.00\t102\tMeet clients.\tSupplemental\t50\t08/2024\tIncumbent",
  "15-1252.00\t103\tA new task without ratings.\tn/a\t\t08/2025\tAnalyst",
  "43-4051.00\t201\tAnswer calls.\tCore\t40\t08/2024\tIncumbent",
].join("\n");

const ratings = [
  "O*NET-SOC Code\tTask ID\tScale ID\tCategory\tData Value\tN\tStandard Error\tLower CI Bound\tUpper CI Bound\tRecommend Suppress\tDate\tDomain Source",
  "15-1252.00\t101\tIM\tn/a\t4.50\t50\t0.1\t4.3\t4.7\tN\t08/2024\tIncumbent",
  "15-1252.00\t101\tFT\t5\t40.00\t50\t\t\t\tN\t08/2024\tIncumbent",
  "15-1252.00\t101\tFT\t7\t60.00\t50\t\t\t\tN\t08/2024\tIncumbent",
  "15-1252.00\t101\tRT\tn/a\t100.00\t50\t\t\t\tN\t08/2024\tIncumbent",
  "15-1252.00\t102\tIM\tn/a\t3.50\t50\t0.1\t3.3\t3.7\tN\t08/2024\tIncumbent",
  "15-1252.00\t102\tFT\t2\t100.00\t50\t\t\t\tN\t08/2024\tIncumbent",
  "43-4051.00\t201\tIM\tn/a\t4.00\t40\t0.1\t3.8\t4.2\tN\t08/2024\tIncumbent",
  "43-4051.00\t201\tFT\t6\t100.00\t40\t\t\t\tN\t08/2024\tIncumbent",
].join("\n");

test("O*NET import keeps only the requested occupations and derives importance and frequency", () => {
  const rows = buildTaskStatements({ statements, ratings, codes: ["15-1252.00"] });
  assert.deepEqual(
    rows.map((r) => [r.task_id, r.task_type, r.importance, r.frequency]),
    [
      [101, "Core", 4.5, 6.2], // 5 x 40% + 7 x 60%
      [102, "Supplemental", 3.5, 2],
      [103, null, 4, 4.1], // occupation means
    ]
  );
  assert.ok(rows.every((r) => r.onetsoc_code === "15-1252.00" && r.source === "onet"));
});

test("O*NET import fails clearly when a file is missing a column", () => {
  assert.throws(() => parseTsv("O*NET-SOC Code\tTask\n", ["Task ID"]), /missing columns: Task ID/);
});

test("O*NET download URL follows the release", () => {
  assert.equal(onetZipUrl("31.0"), "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip");
});

// Exposure math ---------------------------------------------------------------------------

const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 1e6) / 1e6;

test("Time shares follow importance x frequency and sum to 1.0 per job", () => {
  const shares = timeShares([
    { task_id: 1, importance: 4, frequency: 5 }, // 20
    { task_id: 2, importance: 2, frequency: 5 }, // 10
    { task_id: 3, importance: 1, frequency: 10 }, // 10
  ]);
  assert.deepEqual(shares.map((s) => s.time_share), [0.5, 0.25, 0.25]);
});

test("Time shares sum to exactly 1.000000 after rounding", () => {
  const tasks = Array.from({ length: 37 }, (_, i) => ({ task_id: i + 1, importance: 1 + (i % 5) * 0.37, frequency: 1 + (i % 7) * 0.91 }));
  const shares = timeShares(tasks).map((s) => s.time_share);
  assert.equal(sum(shares), 1);
  assert.ok(shares.every((s) => s > 0 && s <= 1 && Number.isInteger(Math.round(s * 1e6))));
});

test("Tasks without ratings (custom upload tasks) get equal shares", () => {
  const shares = timeShares([
    { task_id: 1, importance: null, frequency: null },
    { task_id: 2, importance: null, frequency: null },
    { task_id: 3, importance: 4, frequency: 3 },
    { task_id: 4, importance: null, frequency: null },
  ]);
  assert.deepEqual(shares.map((s) => s.time_share), [0.25, 0.25, 0.25, 0.25]);
});

test("Job tasks come from each job's occupation, and unmapped jobs are reported", () => {
  const tasks = buildTaskStatements({ statements, ratings, codes: ["15-1252.00", "43-4051.00"] });
  const { rows, unmapped } = buildJobTasks(
    "builtin",
    [
      { job_key: "swe", onetsoc_code: "15-1252.00" },
      { job_key: "fe", onetsoc_code: "15-1252.00" },
      { job_key: "cs", onetsoc_code: "43-4051.00" },
      { job_key: "none", onetsoc_code: null },
      { job_key: "unknown", onetsoc_code: "99-9999.00" },
    ],
    tasks
  );
  assert.deepEqual(unmapped, ["none", "unknown"]);
  for (const key of ["swe", "fe", "cs"]) {
    const job = rows.filter((r) => r.job_key === key);
    assert.equal(sum(job.map((r) => r.time_share)), 1, key);
  }
  assert.equal(rows.filter((r) => r.job_key === "swe").length, 3);
  assert.deepEqual(rows.find((r) => r.job_key === "cs"), { dataset_id: "builtin", job_key: "cs", task_id: 201, time_share: 1 });
});

test("Job exposure is the time-share-weighted rubric value", () => {
  const jobTasks = [
    { task_id: 1, time_share: 0.5 },
    { task_id: 2, time_share: 0.3 },
    { task_id: 3, time_share: 0.2 },
  ];
  const labels = new Map([[1, "automate"], [2, "augment"], [3, "unaffected"]]);
  const e = jobExposure(jobTasks, labels);
  assert.equal(e.automate_share, 0.5);
  assert.equal(e.augment_share, 0.3);
  assert.equal(e.exposed_share, 0.8);
  assert.equal(e.exposure_score, 0.65); // 0.5 x 1 + 0.3 x 0.5
});

test("Roll-ups weight by headcount or labor cost and skip unscored jobs", () => {
  const jobs = [
    { value: 0.6, headcount: 30, labor_cost_usd: 3_000_000 },
    { value: 0.2, headcount: 10, labor_cost_usd: 3_000_000 },
    { value: null, headcount: 100, labor_cost_usd: 9_000_000 },
  ];
  assert.equal(weightedRollup(jobs, "headcount"), 0.5); // (18 + 2) / 40
  assert.equal(weightedRollup(jobs, "labor_cost_usd"), 0.4); // (1.8M + 0.6M) / 6M
  assert.equal(weightedRollup([{ value: null, headcount: 5, labor_cost_usd: 1 }], "headcount"), null);
});

// Batching and cost -----------------------------------------------------------------------

test("Batches hold at most 25 tasks from one occupation, with its job titles", () => {
  const tasks = [
    ...Array.from({ length: 30 }, (_, i) => ({ task_id: 1000 + i, onetsoc_code: "15-1252.00", task_text: `t${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ task_id: 2000 + i, onetsoc_code: "43-4051.00", task_text: `c${i}` })),
  ];
  const titles = new Map([["15-1252.00", ["Software Engineer", "Frontend Engineer"]]]);
  const batches = makeBatches(tasks, titles);
  assert.deepEqual(batches.map((b) => [b.onetsoc_code, b.tasks.length]), [
    ["15-1252.00", 15],
    ["15-1252.00", 15],
    ["43-4051.00", 4],
  ]);
  assert.deepEqual(batches[0].job_titles, ["Software Engineer", "Frontend Engineer"]);
  assert.deepEqual(batches[2].job_titles, []);
  assert.deepEqual(batches[0].tasks[0], { task_id: 1000, task: "t0" });
  assert.equal(new Set(batches.flatMap((b) => b.tasks.map((t) => t.task_id))).size, 34);
});

test("Run cost comes from token counts and per-million prices", () => {
  const prices = readPrices({ OPENAI_PRICE_INPUT_PER_1M: "2", OPENAI_PRICE_OUTPUT_PER_1M: "10" });
  assert.equal(costUsd({ input_tokens: 250_000, output_tokens: 40_000 }, prices), 0.9);
  assert.throws(() => readPrices({ OPENAI_PRICE_INPUT_PER_1M: "2" }), /OPENAI_PRICE_OUTPUT_PER_1M/);
  assert.throws(() => readPrices({ OPENAI_PRICE_INPUT_PER_1M: "x", OPENAI_PRICE_OUTPUT_PER_1M: "1" }));
});

const fakeClient = (replies) => {
  const requests = [];
  return {
    requests,
    responses: {
      create: async (body) => {
        requests.push(body);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return { status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output_text: JSON.stringify(reply) };
      },
    },
  };
};

const batch = { onetsoc_code: "15-1252.00", job_titles: ["Software Engineer"], tasks: [{ task_id: 1, task: "Write code." }] };

test("A batch is sent with the rubric prompt, a strict JSON schema, and temperature 0", async () => {
  const client = fakeClient([{ scores: [{ ...valid, task_id: 1 }] }]);
  const usage = { input_tokens: 0, output_tokens: 0 };
  const scores = await scoreBatch({ client, model: "m", prompt: "rubric", batch, settings: { temperature: true }, usage });
  assert.equal(scores.length, 1);
  const [req] = client.requests;
  assert.equal(req.instructions, "rubric");
  assert.equal(req.temperature, 0);
  assert.equal(req.text.format.type, "json_schema");
  assert.equal(req.text.format.strict, true);
  assert.deepEqual(JSON.parse(req.input), batch);
  assert.deepEqual(usage, { input_tokens: 100, output_tokens: 20 });
});

test("An invalid batch response is retried and its tokens still count", async () => {
  const client = fakeClient([{ scores: [] }, { scores: [{ ...valid, task_id: 1 }] }]);
  const usage = { input_tokens: 0, output_tokens: 0 };
  await scoreBatch({ client, model: "m", prompt: "p", batch, settings: { temperature: true }, usage, attempts: 2 });
  assert.equal(client.requests.length, 2);
  assert.deepEqual(usage, { input_tokens: 200, output_tokens: 40 });
});

test("A batch that never validates fails the run", async () => {
  const client = fakeClient([{ scores: [] }, { scores: [] }]);
  await assert.rejects(
    scoreBatch({ client, model: "m", prompt: "p", batch, settings: { temperature: true }, usage: { input_tokens: 0, output_tokens: 0 }, attempts: 2 }),
    /missing task_id 1/
  );
});

test("Models that reject temperature are retried without it", async () => {
  const err = Object.assign(new Error("Unsupported parameter: 'temperature'"), { status: 400, param: "temperature" });
  const client = fakeClient([err, { scores: [{ ...valid, task_id: 1 }] }]);
  const settings = { temperature: true };
  await scoreBatch({ client, model: "m", prompt: "p", batch, settings, usage: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(settings.temperature, false);
  assert.equal(client.requests.length, 2);
  assert.equal("temperature" in client.requests[1], false);
});

test("The scoring workflow runs on demand or on the run-scoring label, with secrets from GitHub", async () => {
  const yml = await readFile(new URL("../.github/workflows/score.yml", import.meta.url), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /github\.event\.label\.name == 'run-scoring'/);
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]) {
    assert.match(yml, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
  assert.match(yml, /npm run score -- --dataset/);
});
