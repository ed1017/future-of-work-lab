import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allocate,
  cohensKappa,
  drawSample,
  kappaBand,
  reviewFromLabel,
  stabilitySummary,
  validationSummary,
} from "../lib/validation/metrics.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const pairs = (a, b) => [...a].map((x, i) => ({ a: x === "a" ? "automate" : x === "g" ? "augment" : "unaffected", b: b[i] === "a" ? "automate" : b[i] === "g" ? "augment" : "unaffected" }));

test("Kappa matches a hand-computed example", () => {
  // Model AAAAABBBCC (automate/augment/unaffected as a/g/u), reviewer AAAABBBCCC:
  // po = 8/10, chance = .5*.4 + .3*.3 + .2*.3 = .35, kappa = (.8 - .35) / .65.
  near(cohensKappa(pairs("aaaaagggu" + "u", "aaaagggu" + "uu")), 0.45 / 0.65);
});

test("Kappa is 1 for identical labels, 0 for chance-level agreement, undefined when degenerate", () => {
  near(cohensKappa(pairs("aggu", "aggu")), 1);
  near(cohensKappa(pairs("aagg", "agag")), 0);
  assert.equal(cohensKappa(pairs("aaaa", "aaaa")), null, "one label throughout: chance agreement is 1");
  assert.equal(cohensKappa([]), null);
});

test("Kappa bands follow Landis and Koch", () => {
  assert.equal(kappaBand(0.69), "substantial");
  assert.equal(kappaBand(0.81), "almost perfect");
  assert.equal(kappaBand(0.2), "slight");
  assert.equal(kappaBand(-0.1), "worse than chance");
  assert.equal(kappaBand(null), null);
});

test("Allocation shares slots equally and passes unused ones to larger labels", () => {
  assert.deepEqual(allocate({ automate: 200, augment: 200, unaffected: 200 }, 100), { automate: 34, augment: 33, unaffected: 33 });
  assert.deepEqual(allocate({ automate: 10, augment: 200, unaffected: 200 }, 100), { automate: 10, augment: 45, unaffected: 45 });
  assert.deepEqual(allocate({ automate: 5, augment: 5, unaffected: 5 }, 100), { automate: 5, augment: 5, unaffected: 5 });
});

const scores = Array.from({ length: 420 }, (_, i) => ({
  run_id: "r1",
  task_id: i + 1,
  label: ["automate", "augment", "unaffected"][i % 7 < 1 ? 0 : i % 7 < 4 ? 1 : 2],
}));

test("The sample is stratified, reproducible, and interleaved so a 50-task prefix is stratified too", () => {
  const sample = drawSample(scores);
  assert.equal(sample.length, 100);
  assert.equal(new Set(sample.map((s) => s.task_id)).size, 100);
  assert.deepEqual(sample.map((s) => s.position), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(drawSample([...scores].reverse()), sample, "input order does not matter");
  const count = (rows, l) => rows.filter((s) => s.stratum === l).length;
  assert.deepEqual([count(sample, "automate"), count(sample, "augment"), count(sample, "unaffected")], [34, 33, 33]);
  const first50 = sample.slice(0, 50);
  assert.deepEqual([count(first50, "automate"), count(first50, "augment"), count(first50, "unaffected")], [17, 17, 16]);
  for (const s of sample) assert.equal(s.stratum, scores[s.task_id - 1].label);
  assert.equal(sample.find((s) => s.stratum === "automate").stratum_size, scores.filter((s) => s.label === "automate").length);
});

test("A blind label becomes agrees or an override", () => {
  assert.deepEqual(reviewFromLabel("augment", "augment"), { agrees: true, override_label: null });
  assert.deepEqual(reviewFromLabel("automate", "augment"), { agrees: false, override_label: "automate" });
});

test("Validation summary: agreement, kappa, per-label rates, and prevalence-weighted agreement", () => {
  // 6 tasks: strata sizes 100 automate, 300 augment, 100 unaffected.
  const sample = [
    { task_id: 1, stratum: "automate", stratum_size: 100, position: 1 },
    { task_id: 2, stratum: "automate", stratum_size: 100, position: 2 },
    { task_id: 3, stratum: "augment", stratum_size: 300, position: 3 },
    { task_id: 4, stratum: "augment", stratum_size: 300, position: 4 },
    { task_id: 5, stratum: "unaffected", stratum_size: 100, position: 5 },
    { task_id: 6, stratum: "unaffected", stratum_size: 100, position: 6 },
  ];
  const model = new Map(sample.map((s) => [s.task_id, s.stratum]));
  const reviews = new Map([
    [1, reviewFromLabel("automate", "automate")],
    [2, reviewFromLabel("augment", "automate")],
    [3, reviewFromLabel("augment", "augment")],
    [4, reviewFromLabel("augment", "augment")],
    [5, reviewFromLabel("unaffected", "unaffected")],
    [6, reviewFromLabel("unaffected", "unaffected")],
  ]);
  const r = validationSummary(sample, model, reviews);
  assert.equal(r.reviewed, 6);
  assert.equal(r.complete, true);
  near(r.agreement, 5 / 6);
  // weights .2/.6/.2 x agreement .5/1/1
  near(r.weightedAgreement, 0.2 * 0.5 + 0.6 + 0.2);
  // model a,a,g,g,u,u vs human a,g,g,g,u,u: po 5/6, pe = (2/6*1/6) + (2/6*3/6) + (2/6*2/6) = 2/36+6/36+4/36
  near(r.kappa, (5 / 6 - 12 / 36) / (1 - 12 / 36));
  assert.deepEqual(r.confusion.automate, { automate: 1, augment: 1, unaffected: 0 });
  assert.deepEqual(r.perLabel.map((p) => [p.reviewed, p.agreed]), [[2, 1], [2, 2], [2, 2]]);
});

test("Partly labeled sample reports on what is labeled and is not complete", () => {
  const sample = [
    { task_id: 1, stratum: "automate", stratum_size: 10, position: 1 },
    { task_id: 2, stratum: "augment", stratum_size: 10, position: 2 },
  ];
  const r = validationSummary(sample, new Map([[1, "automate"], [2, "augment"]]), new Map([[1, reviewFromLabel("automate", "automate")]]));
  assert.equal(r.complete, false);
  assert.equal(r.reviewed, 1);
  assert.equal(r.weightedAgreement, null, "a label with no review leaves the weighted estimate undefined");
  assert.equal(validationSummary([], new Map(), new Map()).agreement, null);
});

test("Stability counts only tasks present in both passes", () => {
  const first = new Map([[1, "automate"], [2, "augment"], [3, "unaffected"], [4, "augment"]]);
  const second = new Map([[1, "automate"], [2, "augment"], [3, "augment"], [9, "augment"]]);
  const r = stabilitySummary(first, second);
  assert.equal(r.tasks, 3);
  assert.equal(r.same, 2);
  near(r.stability, 2 / 3);
});

test("The migration only creates new fow tables and touches nothing else", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261013060000_fow_validation.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "").replace(/on delete cascade/gi, "");
  assert.doesNotMatch(code, /\b(drop|delete|truncate)\b/i);
  assert.doesNotMatch(code, /\bpublic\./i);
  assert.deepEqual([...code.matchAll(/create table (\S+)/g)].map((m) => m[1]), ["fow.validation_sample", "fow.retest_runs", "fow.retest_scores"]);
  for (const t of ["validation_sample", "retest_runs", "retest_scores"]) assert.match(code, new RegExp(`alter table fow\\.${t} enable row level security`));
});
