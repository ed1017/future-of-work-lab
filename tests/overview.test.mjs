import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  QUADRANT_LABEL_COUNT,
  REDESIGN_EXPOSURE_THRESHOLD,
  buildExposureDrilldown,
  buildOverview,
  functionBars,
  jobTaskDetail,
  latestScores,
  normalizeWeighting,
  quadrant,
  registerPreview,
} from "../lib/overview/metrics.mjs";

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/overview/${name}`, import.meta.url), "utf8"));

const rows = (columns, list) => list.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));

/** The view rows the app reads, as captured in snapshot.json. */
const loadData = async () => {
  const s = await fixture("snapshot.json");
  return {
    functionExposure: rows(s.columns.functionExposure, s.functionExposure),
    adoption: rows(s.columns.adoption, s.adoption),
    jobs: rows(s.columns.jobs, s.jobs),
    register: rows(s.columns.register, s.register),
  };
};

const near = (actual, expected, label, tolerance = 5e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected}`);

// Every KPI and chart value is checked against the output of tests/fixtures/overview/queries.sql.

test("Every query in the fixture has a snapshot and an expected value", async () => {
  const sql = await readFile(new URL("./fixtures/overview/queries.sql", import.meta.url), "utf8");
  const expected = await fixture("expected.json");
  for (const key of Object.keys(expected.kpi).concat(["bars", "quadrant", "x_mid"])) {
    assert.match(sql, new RegExp(`'${key}'|${key}`), `queries.sql does not produce ${key}`);
  }
});

for (const weighting of ["headcount", "cost"]) {
  const s = weighting === "cost" ? "cost" : "hc";

  test(`KPI tiles match the SQL (${weighting}-weighted)`, async () => {
    const e = await fixture("expected.json");
    const o = buildOverview(await loadData(), { weighting });
    near(o.kpis.exposure.value, e.kpi[`exposure_${s}`], "exposure");
    near(o.kpis.adoption.rate, e.kpi.adoption_rate_licensed, "adoption rate", 1e-9);
    assert.equal(o.kpis.adoption.activeUsers, e.kpi.active);
    assert.equal(o.kpis.adoption.licensed, e.kpi.licensed);
    assert.equal(o.kpis.useCases.total, e.kpi.use_cases);
    assert.equal(o.kpis.useCases.highRisk, e.kpi.high_risk);
    assert.equal(o.kpis.useCases.overdue, e.kpi.overdue);
    assert.equal(o.kpis.redesign.roles, e.kpi.redesign_roles);
    assert.equal(o.kpis.redesign.employees, e.kpi.redesign_employees);
    assert.equal(o.kpis.redesign.threshold, 0.65);
  });

  test(`Function bars match the SQL (${weighting}-weighted)`, async () => {
    const e = await fixture("expected.json");
    const bars = functionBars((await loadData()).functionExposure, weighting);
    const visible = bars.filter((b) => !b.suppressed);
    assert.equal(visible.length, e.bars.length);
    for (const want of e.bars) {
      const got = visible.find((b) => b.function === want.function);
      assert.ok(got, `missing bar for ${want.function}`);
      assert.equal(got.headcount, want.headcount);
      near(got.automate, want[`automate_${s}`], `${want.function} automate`);
      near(got.augment, want[`augment_${s}`], `${want.function} augment`);
      near(got.exposed, want[`automate_${s}`] + want[`augment_${s}`], `${want.function} exposed`, 1e-5);
      near(got.score, want[`score_${s}`], `${want.function} score`);
    }
  });

  test(`Quadrant bubbles match the SQL (${weighting}-weighted)`, async () => {
    const e = await fixture("expected.json");
    const q = quadrant((await loadData()).adoption, weighting);
    assert.equal(q.points.length, e.quadrant.length);
    assert.equal(q.hiddenFamilies, 1);
    near(q.xMid, e.x_mid, "x line", 1e-9);
    near(q.yMid, e.kpi[`exposure_${s}`], "y line");
    for (const want of e.quadrant) {
      const got = q.points.find((p) => p.function === want.function && p.family === want.family);
      assert.ok(got, `missing ${want.function}/${want.family}`);
      assert.equal(got.headcount, want.headcount);
      near(got.x, want.adoption, `${want.family} adoption`, 1e-9);
      near(got.y, want[`score_${s}`], `${want.family} exposure`);
    }
  });
}

test("Bars are sorted by exposed share, largest first, suppressed functions last", async () => {
  const bars = functionBars((await loadData()).functionExposure, "cost");
  const visible = bars.filter((b) => !b.suppressed);
  for (let i = 1; i < visible.length; i++) assert.ok(visible[i - 1].exposed >= visible[i].exposed);
  assert.equal(bars.at(-1).function, "Corporate Communications");
  assert.equal(bars.at(-1).suppressed, true);
  assert.equal(bars.at(-1).exposed, null);
});

test("Groups under 10 people never appear as values (suppression)", async () => {
  const data = await loadData();
  const o = buildOverview(data);
  assert.ok(!o.quadrant.points.some((p) => p.family === "Corporate Communications"));
  assert.ok(o.quadrant.points.every((p) => p.headcount >= 10));
  assert.ok(o.bars.filter((b) => b.suppressed).every((b) => b.automate === null && b.headcount === null));
  const comms = buildOverview(data, { functionName: "Corporate Communications" });
  assert.equal(comms.kpis.exposure.value, null);
  assert.equal(comms.kpis.exposure.suppressed, true);
  assert.equal(comms.kpis.adoption.suppressed, true);
});

test("The function filter scopes the KPIs and bubbles to that function", async () => {
  const data = await loadData();
  const o = buildOverview(data, { functionName: "Operations", weighting: "cost" });
  near(o.kpis.exposure.value, 0.551729, "Operations exposure");
  near(o.kpis.adoption.rate, 0.3636, "Operations adoption", 1e-9);
  assert.equal(o.kpis.adoption.activeUsers, 593);
  assert.equal(o.kpis.redesign.roles, 1);
  assert.equal(o.kpis.redesign.employees, 447);
  assert.deepEqual(o.quadrant.points.map((p) => p.family).sort(), [
    "Business Operations",
    "Client Operations",
    "Program & Project Management",
  ]);
  // Governance KPIs are company-wide.
  assert.equal(o.kpis.useCases.total, 14);
});

test("Quadrant zones follow the company lines", async () => {
  const q = quadrant((await loadData()).adoption, "cost");
  const zone = (family) => q.points.find((p) => p.family === family).zone;
  assert.equal(zone("Customer Success Management"), "Enable first");
  assert.equal(zone("Client Operations"), "Enable first");
  assert.equal(zone("AI Engineering"), "Govern & scale");
  assert.equal(zone("Business Operations"), "Monitor");
  assert.equal(zone("Data Engineering"), "Check for shadow AI");
  assert.equal(q.labeledKeys.length, QUADRANT_LABEL_COUNT);
  assert.equal(q.labeledKeys[0], "Operations/Program & Project Management");
});

test("Register preview is highest risk first, overdue first within a tier", async () => {
  const preview = registerPreview((await loadData()).register);
  assert.deepEqual(
    preview.map((r) => r.name),
    [
      "Attrition risk model",
      "Performance review summaries",
      "Resume screening assistant",
      "Employee relations case summaries",
      "Internal mobility matching",
    ],
  );
  assert.equal(preview.length, 5);
});

test("Weighting defaults to cost and rejects unknown values", () => {
  assert.equal(normalizeWeighting(undefined), "cost");
  assert.equal(normalizeWeighting("nonsense"), "cost");
  assert.equal(normalizeWeighting("headcount"), "headcount");
  assert.equal(REDESIGN_EXPOSURE_THRESHOLD, 0.65);
});

test("Exposure drill-down lists families and jobs, highest exposure first", async () => {
  const data = await loadData();
  assert.deepEqual(buildExposureDrilldown(data).families, []);
  const d = buildExposureDrilldown(data, { functionName: "Human Resources", weighting: "headcount" });
  assert.equal(d.families.length, 6);
  assert.equal(d.families[0].family, "People Analytics");
  near(d.families[0].score, 0.774154, "People Analytics score");
  const ta = d.families.find((f) => f.family === "Talent Acquisition");
  assert.equal(ta.jobs[0].title, "Talent Acquisition Partner");
  near(ta.jobs[0].automate + ta.jobs[0].augment, ta.jobs[0].exposed, "job shares add up", 1e-5);
  const job = d.families.flatMap((f) => f.jobs).every((j) => j.score !== null);
  assert.ok(job);
});

test("Job exposure shown on the task page is the sum of time share x exposure", () => {
  const scores = latestScores([
    { task_id: 1, label: "automate", exposure: 1, confidence: "high", rationale: "old", run: { status: "succeeded", finished_at: "2026-10-01T00:00:00Z", started_at: "2026-10-01T00:00:00Z" } },
    { task_id: 1, label: "augment", exposure: 0.5, confidence: "medium", rationale: "newer", run: { status: "succeeded", finished_at: "2026-10-02T00:00:00Z", started_at: "2026-10-02T00:00:00Z" } },
    { task_id: 1, label: "unaffected", exposure: 0, confidence: "low", rationale: "failed run", run: { status: "failed", finished_at: "2026-10-03T00:00:00Z", started_at: "2026-10-03T00:00:00Z" } },
    { task_id: 2, label: "automate", exposure: 1, confidence: "high", rationale: "x", run: { status: "succeeded", finished_at: null, started_at: "2026-10-02T00:00:00Z" } },
    { task_id: 3, label: "unaffected", exposure: 0, confidence: "high", rationale: "y", run: { status: "succeeded", finished_at: "2026-10-02T00:00:00Z", started_at: "2026-10-02T00:00:00Z" } },
  ]);
  assert.equal(scores.get(1).rationale, "newer");
  const detail = jobTaskDetail(
    [
      { task_id: 1, time_share: 0.5, task_text: "a" },
      { task_id: 2, time_share: 0.3, task_text: "b" },
      { task_id: 3, time_share: 0.15, task_text: "c" },
      { task_id: 4, time_share: 0.05, task_text: "d" },
    ],
    scores,
  );
  near(detail.exposureScore, 0.5 * 0.5 + 0.3 * 1, "exposure", 1e-12);
  near(detail.coverage, 0.95, "coverage", 1e-12);
  assert.deepEqual(detail.tasks.map((t) => t.taskId), [1, 2, 3, 4]);
  assert.equal(detail.tasks[3].label, null);
});
