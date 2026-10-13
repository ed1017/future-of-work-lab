import assert from "node:assert/strict";
import test from "node:test";
import { adoptionByFunction, enableFirst, managerTeams, pulseSummary, toolMix } from "../lib/adoption/metrics.mjs";

const adoption = [
  { level: "company", function_name: null, family_name: null, suppressed: false, headcount: 1000, exposure_score_cost: 0.5, exposure_score_hc: 0.5, weekly_active_rate: 0.4, licensed_rate: 0.6, shadow_ai_rate: 0.1, week_start: "2026-09-21" },
  { level: "function", function_name: "A", suppressed: false, headcount: 600, weekly_active_rate: 0.5, licensed_rate: 0.7 },
  { level: "function", function_name: "B", suppressed: false, headcount: 400, weekly_active_rate: 0.25, licensed_rate: 0.4 },
  { level: "family", function_name: "B", family_name: "B1", suppressed: false, headcount: 200, exposure_score_cost: 0.8, exposure_score_hc: 0.4, weekly_active_rate: 0.2 },
  { level: "family", function_name: "B", family_name: "B2", suppressed: false, headcount: 200, exposure_score_cost: 0.6, exposure_score_hc: 0.7, weekly_active_rate: 0.3 },
  { level: "family", function_name: "A", family_name: "A1", suppressed: false, headcount: 300, exposure_score_cost: 0.9, exposure_score_hc: 0.9, weekly_active_rate: 0.6 },
  { level: "family", function_name: "A", family_name: "A2", suppressed: true, headcount: null, exposure_score_cost: null, exposure_score_hc: null, weekly_active_rate: null },
];

test("Functions are ranked by weekly active rate and the company row is separate", () => {
  const out = adoptionByFunction(adoption);
  assert.deepEqual(out.rows.map((r) => r.function), ["A", "B"]);
  assert.equal(out.company.weeklyActiveRate, 0.4);
  assert.equal(out.company.shadowRate, 0.1);
});

test("Enable-first = more exposed and less adopted than the company, most exposed first", () => {
  const cost = enableFirst(adoption, "cost");
  assert.deepEqual(cost.rows.map((r) => r.family), ["B1", "B2"]);
  assert.equal(cost.rows[0].gap.toFixed(2), "0.20");
  assert.deepEqual(enableFirst(adoption, "headcount").rows.map((r) => r.family), ["B2"]);
});

test("Manager teams are labelled by function and team number, never a person", () => {
  const out = managerTeams([
    { function_name: "A", team_number: 2, headcount: 12, weekly_active_rate: 0.3, licensed_rate: 0.5 },
    { function_name: "A", team_number: 1, headcount: 14, weekly_active_rate: 0.6, licensed_rate: 0.8 },
  ]);
  assert.deepEqual(out.map((t) => t.label), ["A · Team 1", "A · Team 2"]);
});

test("Tool mix lists approved tools first, shadow AI last", () => {
  const out = toolMix([
    { name: "Shadow", approved: false, weekly_active_users: 90 },
    { name: "Small", approved: true, weekly_active_users: 20 },
    { name: "Big", approved: true, weekly_active_users: 500 },
    { name: "Hidden", approved: true, weekly_active_users: null },
  ]);
  assert.deepEqual(out.map((t) => t.name), ["Big", "Small", "Hidden", "Shadow"]);
});

test("Pulse summary reports the latest wave and the change since the previous one", () => {
  const q = (code, date, rate, level = "company") => ({ level, function_name: null, question_code: code, question_text: `Q ${code}`, response_date: date, respondents: 100, favorable_rate: rate });
  const out = pulseSummary([q("a", "2026-06-17", 0.4), q("a", "2026-09-15", 0.5), q("b", "2026-09-15", 0.7), q("a", "2026-09-15", 0.1, "function")]);
  assert.equal(out.latest, "2026-09-15");
  assert.equal(out.previous, "2026-06-17");
  const a = out.rows.find((r) => r.code === "a");
  assert.equal(a.favorable, 0.5);
  assert.equal(a.change.toFixed(2), "0.10");
  assert.equal(out.rows.find((r) => r.code === "b").change, null);
});
