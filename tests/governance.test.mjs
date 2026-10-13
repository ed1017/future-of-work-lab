import assert from "node:assert/strict";
import test from "node:test";
import { daysOverdue, filterRegister, registerSummary, sortRegister } from "../lib/governance/register.mjs";
import { assessmentSchema, fieldErrors, useCaseSchema } from "../lib/governance/schema.mjs";

const row = (over) => ({
  use_case_id: "id",
  name: "Case",
  risk_tier: "low",
  status: "production",
  is_overdue: false,
  bias_audit_due: false,
  review_status: "Approved",
  next_review_date: "2027-01-01",
  ...over,
});

const register = [
  row({ name: "Fine", risk_tier: "low" }),
  row({ name: "Late", risk_tier: "high", is_overdue: true, review_status: "Overdue", next_review_date: "2026-07-31" }),
  row({ name: "Audit", risk_tier: "high", bias_audit_due: true, review_status: "Bias audit due" }),
  row({ name: "New", risk_tier: null, status: "proposed", review_status: "Not reviewed" }),
  row({ name: "Late low", risk_tier: "low", is_overdue: true, review_status: "Overdue", next_review_date: "2026-09-01" }),
];

test("Overdue reviews are counted and sorted to the top", () => {
  assert.equal(registerSummary(register).overdue, 2);
  assert.equal(registerSummary(register).biasAuditDue, 1);
  assert.deepEqual(
    sortRegister(register).map((r) => r.name),
    ["Late", "Late low", "Audit", "Fine", "New"],
  );
});

test("Filters narrow by tier, status, and review", () => {
  assert.deepEqual(filterRegister(register, { tier: "unassessed" }).map((r) => r.name), ["New"]);
  assert.deepEqual(filterRegister(register, { tier: "high" }).map((r) => r.name), ["Late", "Audit"]);
  assert.deepEqual(filterRegister(register, { status: "proposed" }).map((r) => r.name), ["New"]);
  assert.deepEqual(filterRegister(register, { review: "flagged" }).map((r) => r.name), ["Late", "Audit", "Late low"]);
  assert.equal(filterRegister(register, {}).length, 5);
});

test("Days overdue counts whole days past the review date", () => {
  assert.equal(daysOverdue("2026-07-31", new Date("2026-10-13T08:00:00Z")), 74);
  assert.equal(daysOverdue("2026-10-13", new Date("2026-10-13T23:00:00Z")), 0);
  assert.equal(daysOverdue(null), null);
});

test("Use case input is validated and normalised", () => {
  const ok = useCaseSchema.parse({
    name: " Resume screen ",
    hr_process: "Recruiting",
    tool_id: "",
    decision_impact: "informs",
    owner: "Talent Acquisition",
    human_in_loop: "yes",
    status: "pilot",
    description: "",
  });
  assert.equal(ok.name, "Resume screen");
  assert.equal(ok.tool_id, null);
  assert.equal(ok.human_in_loop, true);
  assert.equal(ok.description, null);
  const bad = useCaseSchema.safeParse({ name: "", hr_process: "x", tool_id: "Not A Tool", decision_impact: "decides", owner: "t", human_in_loop: "maybe", status: "live", description: "" });
  assert.equal(bad.success, false);
  assert.deepEqual(Object.keys(fieldErrors(bad.error)).sort(), ["decision_impact", "human_in_loop", "name", "status", "tool_id"]);
});

test("Assessment input is validated, including review date order", () => {
  const base = {
    use_case_id: "5b0f7a9e-0000-4000-8000-000000000001",
    framework: "NYC LL 144",
    tier: "high",
    rationale: "Screens candidates",
    review_state: "in_review",
    assessed_on: "2026-10-13",
    bias_audit_date: "",
    next_review_date: "2027-10-13",
  };
  const ok = assessmentSchema.parse(base);
  assert.equal(ok.bias_audit_date, null);
  assert.equal(assessmentSchema.safeParse({ ...base, next_review_date: "2026-01-01" }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...base, framework: "Made up" }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...base, assessed_on: "13/10/2026" }).success, false);
});
