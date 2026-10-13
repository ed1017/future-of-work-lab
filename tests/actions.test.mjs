import assert from "node:assert/strict";
import test from "node:test";
import { checkRecommendation, dataPoint, describeSource, evidenceHref, formatValue, resolveEvidence } from "../lib/actions/evidence.mjs";
import { buildFunctionFacts, planningScope, rowsByView } from "../lib/actions/facts.mjs";
import { loadPrompt, numbersIn, recommendationSchema, toRecommendationRow } from "../lib/actions/plan.mjs";
import { buildPlan, latestBatch, topActions } from "../lib/actions/screen.mjs";

const D = "builtin";

/** A small company in the shape of the fow views. */
const rows = {
  functionExposure: [
    { dataset_id: D, function_name: null, is_total: true, suppressed: false, headcount: 1000, exposure_score_cost: 0.55, automate_share_cost: 0.3, augment_share_cost: 0.5 },
    { dataset_id: D, function_name: "Ops", is_total: false, suppressed: false, headcount: 600, exposure_score_cost: 0.7, automate_share_cost: 0.45, augment_share_cost: 0.5 },
    { dataset_id: D, function_name: "Human Resources", is_total: false, suppressed: false, headcount: 395, exposure_score_cost: 0.4, automate_share_cost: 0.2, augment_share_cost: 0.4 },
    { dataset_id: D, function_name: "Comms", is_total: false, suppressed: true, headcount: null, exposure_score_cost: null, automate_share_cost: null, augment_share_cost: null },
  ],
  adoption: [
    { dataset_id: D, level: "company", function_name: null, family_name: null, suppressed: false, headcount: 1000, weekly_active_rate: 0.5, licensed_rate: 0.8, weekly_active_rate_licensed: 0.62, shadow_ai_rate: 0.09 },
    { dataset_id: D, level: "function", function_name: "Ops", family_name: null, suppressed: false, headcount: 600, weekly_active_rate: 0.24, licensed_rate: 0.6, weekly_active_rate_licensed: 0.4, shadow_ai_rate: 0.12 },
    { dataset_id: D, level: "family", function_name: "Ops", family_name: "Client Ops", suppressed: false, headcount: 400, exposure_score_cost: 0.85, weekly_active_rate: 0.2 },
    { dataset_id: D, level: "family", function_name: "Ops", family_name: "Tiny", suppressed: true, headcount: null, exposure_score_cost: null, weekly_active_rate: null },
  ],
  jobs: [
    { dataset_id: D, job_key: "OPS-CLIENT", title: "Client Ops Specialist", function_name: "Ops", suppressed: false, headcount: 400, exposure_score: 0.854 },
    { dataset_id: D, job_key: "OPS-BUS", title: "Business Ops Analyst", function_name: "Ops", suppressed: false, headcount: 200, exposure_score: 0.464 },
    { dataset_id: D, job_key: "HR-TA", title: "Recruiter", function_name: "Human Resources", suppressed: false, headcount: 395, exposure_score: 0.4 },
  ],
  managers: [
    { function_name: "Ops", team_number: 1, headcount: 20, weekly_active_rate: 0.3 },
    { function_name: "Ops", team_number: 2, headcount: 12, weekly_active_rate: 0.1 },
  ],
  pulse: [
    { level: "company", function_name: null, question_code: "ai_training", response_date: "2026-09-15", suppressed: false, favorable_rate: 0.39 },
    { level: "function", function_name: "Ops", question_code: "ai_training", response_date: "2026-09-15", suppressed: false, favorable_rate: 0.31 },
    { level: "function", function_name: "Ops", question_code: "ai_training", response_date: "2026-06-17", suppressed: false, favorable_rate: 0.2 },
  ],
  register: [
    { use_case_id: "u1", name: "Resume screening assistant", risk_tier: "high", is_overdue: false, bias_audit_due: true },
    { use_case_id: "u2", name: "Chatbot", risk_tier: "low", is_overdue: false, bias_audit_due: false },
  ],
  readiness: [
    { dataset_id: D, level: "company", function_name: null, ai_skilled_rate: 0.29, required_skills_met_rate: 0.81, ai_interest_rate: 0.17, open_to_move_rate: 0.15 },
    { dataset_id: D, level: "function", function_name: "Ops", ai_skilled_rate: 0.22, required_skills_met_rate: 0.82, ai_interest_rate: 0.21, open_to_move_rate: 0.19 },
  ],
  skillGaps: [
    { dataset_id: D, function_name: "Ops", skill_code: "PM", skill_name: "Project Management", importance: "required", employees_in_scope: 400, meets_required_rate: 0.7, course_count: 1, courses: [{ course_code: "C-PM" }] },
  ],
  paths: [
    { dataset_id: D, from_job_key: "OPS-CLIENT", to_job_key: "OPS-BUS", from_title: "Client Ops Specialist", to_title: "Business Ops Analyst", to_function: "Ops", from_function: "Ops", basis: "skills", shared_skills: 2, shared_skill_names: ["Advanced Excel", "Project Management"], interested_employees: null, from_exposure_score: 0.854, to_exposure_score: 0.464, exposure_change: -0.39 },
  ],
  courses: [
    { course_code: "C-PM", course_name: "Project Management Essentials", provider: "LinkedIn Learning", duration_hours: 6, skill_name: "Project Management", skill_category: "Operations" },
    { course_code: "C-AI", course_name: "Generative AI at Work", provider: "Coursera", duration_hours: 8, skill_name: "Generative AI", skill_category: "AI" },
  ],
};
const views = rowsByView(rows);

test("A data point keeps only the key columns of its view, and numbers stay numbers", () => {
  const p = dataPoint("v_exposure_adoption", { ...rows.adoption[1], weekly_active_rate: "0.2400" }, "weekly_active_rate", { label: "x", format: "pct" });
  assert.deepEqual(p.key, { dataset_id: D, level: "function", function_name: "Ops", family_name: null });
  assert.equal(p.value, 0.24);
  assert.equal(p.kind, "metric");
  assert.throws(() => dataPoint("employees", {}, "x", { label: "x", format: "pct" }), /not a citable view/);
  assert.throws(() => dataPoint("v_job_exposure", rows.jobs[0], "salary", { label: "x", format: "pct" }), /no column/);
});

test("Cited points resolve as match, changed, or missing against the current rows", () => {
  const p = dataPoint("v_exposure_adoption", rows.adoption[1], "weekly_active_rate", { label: "x", format: "pct" });
  assert.equal(resolveEvidence(p, views).status, "match");
  const changed = rowsByView({ ...rows, adoption: [{ ...rows.adoption[1], weekly_active_rate: 0.3 }] });
  assert.deepEqual(resolveEvidence(p, changed).status, "changed");
  assert.equal(resolveEvidence(p, rowsByView({ ...rows, adoption: [] })).status, "missing");
  const suppressed = rowsByView({ ...rows, adoption: [{ ...rows.adoption[1], weekly_active_rate: null }] });
  assert.equal(resolveEvidence(p, suppressed).status, "missing", "a value suppressed since then does not count");
});

test("Functions under 10 people get no plan", () => {
  assert.deepEqual(planningScope(rows.functionExposure), { planned: ["Human Resources", "Ops"], skipped: ["Comms"] });
});

test("Every fact offered to the model is a row that exists in a view, with a unique id", () => {
  const offered = buildFunctionFacts(rows, "Ops");
  const all = [...offered.facts, ...offered.courses, ...offered.targets];
  assert.ok(offered.facts.length >= 15);
  assert.equal(new Set(all.map((f) => f.id)).size, all.length);
  for (const f of all) assert.equal(resolveEvidence(f, views).status, "match", `${f.id} ${f.label}`);
  assert.ok(!offered.facts.some((f) => f.label.includes("Tiny")), "suppressed families are left out");
  assert.ok(!offered.facts.some((f) => f.view === "v_register"), "register facts go to HR only");
  assert.deepEqual(offered.courses.map((c) => c.key.course_code), ["C-PM", "C-AI"]);
  assert.equal(offered.targets[0].display, "-39%");
  const hr = buildFunctionFacts(rows, "Human Resources");
  assert.ok(hr.facts.some((f) => f.view === "v_register" && f.field === "bias_audit_due"));
});

const offered = buildFunctionFacts(rows, "Ops");
const id = (label) => offered.facts.find((f) => f.label === label)?.id;
const exposureId = id("Ops AI exposure score (cost-weighted)");
const adoptionId = id("Ops weekly active AI users, share of headcount");
const valid = {
  move: "reskill",
  text: "Ops is 70% exposed but only 24% of its people use AI weekly. Start with Client Ops.",
  evidence_ids: [exposureId, adoptionId],
  course_ids: ["C2"],
  target_ids: [],
};

test("A valid answer passes, and every number in its text comes from what it cites", () => {
  assert.ok(exposureId && adoptionId);
  assert.deepEqual(numbersIn("70% of 1,333 people, 0.5"), ["70", "1333", "0.5"]);
  const parsed = recommendationSchema(offered).safeParse(valid);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test("The schema rejects thin or untraceable recommendations", () => {
  const schema = recommendationSchema(offered);
  const reject = (patch, pattern) => {
    const r = schema.safeParse({ ...valid, ...patch });
    assert.ok(!r.success, JSON.stringify(patch));
    assert.match(r.error.issues.map((i) => i.message).join("; "), pattern);
  };
  reject({ evidence_ids: [exposureId] }, /at least 2/);
  reject({ evidence_ids: [exposureId, exposureId] }, /duplicate|at least 2/);
  reject({ evidence_ids: [exposureId, "F999"] }, /unknown evidence id F999/);
  reject({ course_ids: ["C9"] }, /unknown course id/);
  reject({ text: "Ops is 71% exposed and 24% use AI." }, /number 71/);
  reject({ text: Array.from({ length: 71 }, () => "word").join(" ") }, /70 words/);
  reject({ move: "redeploy" }, /needs at least one target/);
  reject({ move: "fire" }, /./);
});

test("A stored row carries the cited points without model-facing ids", () => {
  const row = toRecommendationRow({
    datasetId: D,
    offered,
    answer: { ...valid, move: "redeploy", target_ids: ["T1"] },
    model: "m",
    runId: null,
    promptSha: "abc",
    createdAt: "2026-10-13T00:00:00.000Z",
  });
  assert.equal(row.scope_key, "Ops");
  assert.deepEqual(row.evidence.map((e) => e.kind), ["metric", "metric", "course", "target"]);
  for (const e of row.evidence) {
    assert.ok(!("id" in e) && !("display" in e));
    assert.equal(resolveEvidence(e, views).status, "match");
  }
  const check = checkRecommendation(row, views);
  assert.ok(check.passes);
  assert.equal(check.metricsMatching, 2);
});

test("Evidence links open the screen that shows the cited row", () => {
  const point = (view, row, field) => dataPoint(view, row, field, { label: "x", format: "pct" });
  assert.equal(evidenceHref(point("v_exposure_adoption", rows.adoption[1], "weekly_active_rate")), "/adoption?function=Ops");
  assert.equal(evidenceHref(point("v_function_exposure", rows.functionExposure[1], "exposure_score_cost")), "/exposure?function=Ops");
  const job = point("v_job_exposure", rows.jobs[0], "exposure_score");
  assert.equal(evidenceHref(job, rows.jobs[0]), "/exposure?function=Ops&job=OPS-CLIENT");
  assert.equal(evidenceHref(point("v_register", rows.register[0], "bias_audit_due")), "/governance");
  assert.equal(evidenceHref(point("v_function_readiness", rows.readiness[1], "ai_skilled_rate")), null);
  assert.match(describeSource(job), /^fow\.v_job_exposure where dataset_id = 'builtin' and job_key = 'OPS-CLIENT'; column exposure_score$/);
  assert.equal(formatValue(0.2395, "pct"), "24%");
  assert.equal(formatValue(1333, "int"), "1,333");
});

test("Screens show the newest batch, most urgent move first", () => {
  const recs = [
    { scope_key: "Ops", move: "hold", created_at: "2026-10-12T00:00:00Z", text: "old", evidence: [] },
    { scope_key: "Human Resources", move: "reskill", created_at: "2026-10-13T00:00:00.000Z", text: "", evidence: [] },
    { scope_key: "Ops", move: "redesign", created_at: "2026-10-13T00:00:00+00:00", text: "", evidence: [] },
  ];
  assert.deepEqual(latestBatch(recs).map((r) => r.text === "old"), [false, false]);
  assert.deepEqual(topActions(recs, rows.functionExposure).map((r) => `${r.scope_key}:${r.move}`), ["Ops:redesign", "Human Resources:reskill"]);
  const plan = buildPlan(recs, views, rows.functionExposure);
  assert.equal(plan.allPass, false, "recommendations with no evidence fail the check");
});

test("The planner prompt is versioned in the repo and hashed", async () => {
  const prompt = await loadPrompt();
  assert.match(prompt.text, /redesign[\s\S]*reskill[\s\S]*redeploy[\s\S]*hold/);
  assert.match(prompt.text, /at least two fact ids/);
  assert.match(prompt.sha, /^[0-9a-f]{64}$/);
});
