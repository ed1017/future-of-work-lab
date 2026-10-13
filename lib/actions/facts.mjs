// The data points the planner may cite for one function, built from the fow view rows.
// Each fact is one column of one row, so every number the model sees can be traced back.
// Exposure uses the cost-weighted score, the app's default weighting. No I/O here.
import { dataPoint, formatValue } from "./evidence.mjs";
import { REDESIGN_EXPOSURE_THRESHOLD } from "../overview/metrics.mjs";

/**
 * @typedef {import("./evidence.mjs").DataPoint} DataPoint
 * @typedef {DataPoint & { id: string, display: string }} Fact
 * @typedef {Record<string, any>} Row
 * @typedef {object} PlannerRows  rows of each view, builtin dataset
 * @property {Row[]} functionExposure  v_function_exposure
 * @property {Row[]} adoption          v_exposure_adoption
 * @property {Row[]} jobs              v_job_exposure
 * @property {Row[]} managers          v_adoption_manager
 * @property {Row[]} pulse             v_pulse_sentiment
 * @property {Row[]} register          v_register
 * @property {Row[]} readiness         v_function_readiness
 * @property {Row[]} skillGaps         v_function_skill_gaps
 * @property {Row[]} paths             v_redeployment_paths
 * @property {Row[]} courses           v_course_catalog
 */

/** The view each PlannerRows property holds. */
export const PLANNER_VIEWS = /** @type {const} */ ({
  functionExposure: "v_function_exposure",
  adoption: "v_exposure_adoption",
  jobs: "v_job_exposure",
  managers: "v_adoption_manager",
  pulse: "v_pulse_sentiment",
  register: "v_register",
  readiness: "v_function_readiness",
  skillGaps: "v_function_skill_gaps",
  paths: "v_redeployment_paths",
  courses: "v_course_catalog",
});

/** @param {PlannerRows} rows */
export const rowsByView = (rows) =>
  Object.fromEntries(Object.entries(PLANNER_VIEWS).map(([prop, view]) => [view, rows[/** @type {keyof PlannerRows} */ (prop)] ?? []]));

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** HR runs the register's use cases, so register facts go to the Human Resources plan. */
export const REGISTER_FUNCTION = "Human Resources";

const PULSE_LABELS = {
  ai_helps_work: "say AI tools help them work faster",
  ai_job_worry: "are not worried AI will change their job in unwanted ways",
  ai_manager_support: "say their manager encourages them to try AI",
  ai_policy_clear: "know which AI tools they may use",
  ai_training: "say they have had enough AI training",
  ai_trust_output: "trust AI output after checking it",
};

/**
 * Functions that get a plan: those not suppressed in v_function_exposure.
 * @param {Row[]} functionExposure
 */
export function planningScope(functionExposure) {
  const fns = functionExposure.filter((r) => !r.is_total && r.function_name);
  return {
    planned: fns.filter((r) => !r.suppressed && r.headcount !== null).map((r) => /** @type {string} */ (r.function_name)).sort(),
    skipped: fns.filter((r) => r.suppressed || r.headcount === null).map((r) => /** @type {string} */ (r.function_name)).sort(),
  };
}

/**
 * Everything the planner may cite for one function: metric facts, courses, and moves.
 * @param {PlannerRows} rows
 * @param {string} fn
 */
export function buildFunctionFacts(rows, fn) {
  /** @type {Fact[]} */
  const facts = [];
  /** @type {Fact[]} */
  const courses = [];
  /** @type {Fact[]} */
  const targets = [];
  const add = (list, prefix, point) => {
    if (point.value === null) return;
    list.push({ ...point, id: `${prefix}${list.length + 1}`, display: formatValue(point.value, point.format) });
  };
  const fact = (view, row, field, label, format = "pct") => row && add(facts, "F", dataPoint(view, row, field, { label, format }));

  // Exposure
  const fx = rows.functionExposure.find((r) => !r.is_total && r.function_name === fn);
  const fxCompany = rows.functionExposure.find((r) => r.is_total);
  fact("v_function_exposure", fx, "headcount", `${fn} headcount`, "int");
  fact("v_function_exposure", fx, "exposure_score_cost", `${fn} AI exposure score (cost-weighted)`);
  fact("v_function_exposure", fx, "automate_share_cost", `${fn} share of task time AI could automate`);
  fact("v_function_exposure", fx, "augment_share_cost", `${fn} share of task time AI could augment`);
  fact("v_function_exposure", fxCompany, "exposure_score_cost", "Company AI exposure score (cost-weighted)");

  // Adoption
  const ad = rows.adoption.find((r) => r.level === "function" && r.function_name === fn);
  const adCompany = rows.adoption.find((r) => r.level === "company");
  fact("v_exposure_adoption", ad, "weekly_active_rate", `${fn} weekly active AI users, share of headcount`);
  fact("v_exposure_adoption", adCompany, "weekly_active_rate", "Company weekly active AI users, share of headcount");
  fact("v_exposure_adoption", ad, "licensed_rate", `${fn} share of people with an AI licence`);
  fact("v_exposure_adoption", ad, "weekly_active_rate_licensed", `${fn} weekly active AI users, share of licensed people`);
  fact("v_exposure_adoption", ad, "shadow_ai_rate", `${fn} share using an unapproved AI tool in the last 4 weeks`);
  fact("v_exposure_adoption", adCompany, "shadow_ai_rate", "Company share using an unapproved AI tool in the last 4 weeks");

  // Job families, largest first
  const families = rows.adoption
    .filter((r) => r.level === "family" && r.function_name === fn && !r.suppressed)
    .sort((a, b) => num(b.headcount) - num(a.headcount) || String(a.family_name).localeCompare(String(b.family_name)))
    .slice(0, 4);
  for (const f of families) {
    fact("v_exposure_adoption", f, "exposure_score_cost", `${f.family_name} family AI exposure score`);
    fact("v_exposure_adoption", f, "weekly_active_rate", `${f.family_name} family weekly active AI users, share of headcount`);
  }

  // Jobs: those flagged for redesign, else the most exposed
  const jobs = rows.jobs
    .filter((j) => j.function_name === fn && !j.suppressed && j.exposure_score !== null)
    .sort((a, b) => num(b.exposure_score) - num(a.exposure_score) || String(a.title).localeCompare(String(b.title)));
  const flagged = jobs.filter((j) => num(j.exposure_score) >= REDESIGN_EXPOSURE_THRESHOLD);
  for (const j of (flagged.length ? flagged : jobs).slice(0, 4)) {
    fact("v_job_exposure", j, "exposure_score", `${j.title} AI exposure score`);
    fact("v_job_exposure", j, "headcount", `${j.title} headcount`, "int");
  }

  // Manager teams: lowest and highest adoption
  const teams = rows.managers
    .filter((t) => t.function_name === fn)
    .sort((a, b) => num(a.weekly_active_rate) - num(b.weekly_active_rate) || a.team_number - b.team_number);
  for (const t of teams.length > 1 ? [teams[0], teams.at(-1)] : teams) {
    fact("v_adoption_manager", t, "weekly_active_rate", `${fn} team ${t.team_number} weekly active AI users`);
  }

  // Pulse: latest wave, function and company
  const waves = [...new Set(rows.pulse.map((r) => r.response_date))].sort();
  const latest = waves.at(-1);
  for (const code of Object.keys(PULSE_LABELS)) {
    const fnRow = rows.pulse.find((r) => r.level === "function" && r.function_name === fn && r.question_code === code && r.response_date === latest);
    const coRow = rows.pulse.find((r) => r.level === "company" && r.question_code === code && r.response_date === latest);
    if (fnRow && !fnRow.suppressed) fact("v_pulse_sentiment", fnRow, "favorable_rate", `${fn}: share who ${PULSE_LABELS[code]} (${latest} pulse)`);
    if (coRow && !coRow.suppressed) fact("v_pulse_sentiment", coRow, "favorable_rate", `Company: share who ${PULSE_LABELS[code]} (${latest} pulse)`);
  }

  // Readiness
  const rd = rows.readiness.find((r) => r.level === "function" && r.function_name === fn);
  const rdCompany = rows.readiness.find((r) => r.level === "company");
  fact("v_function_readiness", rd, "ai_skilled_rate", `${fn} share with an AI skill at proficiency 3 or higher`);
  fact("v_function_readiness", rdCompany, "ai_skilled_rate", "Company share with an AI skill at proficiency 3 or higher");
  fact("v_function_readiness", rd, "required_skills_met_rate", `${fn} required skills held at the required level`);
  fact("v_function_readiness", rd, "ai_interest_rate", `${fn} share whose career interest is AI & Digital Skills`);
  fact("v_function_readiness", rd, "open_to_move_rate", `${fn} share asking to move to a different job`);

  // Skill gaps: required skills with the lowest coverage
  const gaps = rows.skillGaps
    .filter((g) => g.function_name === fn && g.importance === "required")
    .sort((a, b) => num(a.meets_required_rate) - num(b.meets_required_rate) || String(a.skill_name).localeCompare(String(b.skill_name)))
    .slice(0, 3);
  for (const g of gaps) {
    fact("v_function_skill_gaps", g, "meets_required_rate", `${fn} people at the required ${g.skill_name} level (${g.employees_in_scope} in scope)`);
  }

  // Register (HR only): high-risk, overdue, or bias-audit-due use cases
  if (fn === REGISTER_FUNCTION) {
    for (const u of rows.register) {
      if (u.is_overdue) fact("v_register", u, "is_overdue", `${u.name} review is overdue`, "bool");
      if (u.bias_audit_due) fact("v_register", u, "bias_audit_due", `${u.name} bias audit is due`, "bool");
      if (u.risk_tier === "high" && !u.is_overdue && !u.bias_audit_due) fact("v_register", u, "risk_tier", `${u.name} risk tier`, "text");
    }
  }

  // Courses: for the function's weakest required skills, then AI courses
  const offered = new Set();
  const offerCourse = (code) => {
    const c = rows.courses.find((r) => r.course_code === code);
    if (!c || offered.has(code)) return;
    offered.add(code);
    add(
      courses,
      "C",
      dataPoint("v_course_catalog", c, "course_name", {
        label: `Course for ${c.skill_name}: ${c.provider}, ${formatValue(c.duration_hours, "int")} hours`,
        format: "text",
        kind: "course",
      }),
    );
  };
  const gapRows = rows.skillGaps
    .filter((g) => g.function_name === fn && Number(g.course_count) > 0)
    .sort((a, b) => num(a.meets_required_rate) - num(b.meets_required_rate) || String(a.skill_name).localeCompare(String(b.skill_name)));
  for (const g of gapRows.slice(0, 4)) for (const c of g.courses ?? []) offerCourse(c.course_code);
  for (const c of rows.courses.filter((r) => r.skill_category === "AI")) offerCourse(c.course_code);

  // Redeployment targets out of this function's jobs: least exposed destination first
  const paths = rows.paths
    .filter((p) => p.from_function === fn)
    .sort(
      (a, b) =>
        num(a.exposure_change) - num(b.exposure_change) ||
        (num(b.interested_employees) ?? 0) - (num(a.interested_employees) ?? 0) ||
        String(a.from_job_key).localeCompare(String(b.from_job_key)) ||
        String(a.to_job_key).localeCompare(String(b.to_job_key)),
    )
    .slice(0, 6);
  for (const p of paths) {
    const why = [
      p.interested_employees ? `${p.interested_employees} people asked for this move` : null,
      Number(p.shared_skills) ? `shares ${(p.shared_skill_names ?? []).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    add(
      targets,
      "T",
      dataPoint("v_redeployment_paths", p, "exposure_change", {
        label: `${p.from_title} → ${p.to_title} (${p.to_function}); exposure ${formatValue(p.from_exposure_score, "pct")} → ${formatValue(p.to_exposure_score, "pct")}${why ? `; ${why}` : ""}`,
        format: "pct",
        kind: "target",
      }),
    );
  }

  return { function: fn, facts, courses, targets };
}
