// Evidence for the action planner: a data point is one column of one row in a fow view.
// The planner stores the point it cited (view, key, field, value); the Action plan
// screen and the acceptance check look the same row up again to show it still exists.
// No I/O here.

/**
 * @typedef {"pct" | "int" | "text" | "bool"} ValueFormat
 * @typedef {"metric" | "course" | "target"} EvidenceKind
 * @typedef {object} DataPoint
 * @property {string} view       fow view name, without the schema
 * @property {Record<string, string | number | boolean | null>} key  columns that pick out one row
 * @property {string} field      the column cited
 * @property {string | number | boolean | null} value  the value when the plan was generated
 * @property {string} label      plain-language name for the number
 * @property {ValueFormat} format
 * @property {EvidenceKind} kind  metric = a number the recommendation rests on; course and target are suggestions
 */

/** Columns that identify one row in each view the planner may cite. */
export const VIEW_KEYS = {
  v_function_exposure: ["dataset_id", "is_total", "function_name"],
  v_exposure_adoption: ["dataset_id", "level", "function_name", "family_name"],
  v_job_exposure: ["dataset_id", "job_key"],
  v_adoption_manager: ["function_name", "team_number"],
  v_pulse_sentiment: ["level", "function_name", "question_code", "response_date"],
  v_register: ["use_case_id"],
  v_function_readiness: ["dataset_id", "level", "function_name"],
  v_function_skill_gaps: ["dataset_id", "function_name", "skill_code", "importance"],
  v_redeployment_paths: ["dataset_id", "from_job_key", "to_job_key"],
  v_course_catalog: ["course_code"],
};

/** @typedef {keyof typeof VIEW_KEYS} ViewName */

export const CITABLE_VIEWS = /** @type {ViewName[]} */ (Object.keys(VIEW_KEYS));

/** Every recommendation must cite at least this many metric data points. */
export const MIN_METRIC_EVIDENCE = 2;

const NUMERIC_TOLERANCE = 1e-6;

/**
 * @param {ViewName} view
 * @param {Record<string, unknown>} row
 * @param {string} field
 * @param {{ label: string, format: ValueFormat, kind?: EvidenceKind }} meta
 * @returns {DataPoint}
 */
export function dataPoint(view, row, field, { label, format, kind = "metric" }) {
  const keys = VIEW_KEYS[view];
  if (!keys) throw new Error(`${view} is not a citable view`);
  if (!(field in row)) throw new Error(`${view} has no column ${field}`);
  const key = Object.fromEntries(keys.map((k) => [k, normalize(row[k] ?? null)]));
  return { view, key, field, value: normalize(row[field] ?? null), label, format, kind };
}

/** PostgREST can return numeric columns as strings; store numbers as numbers. */
const normalize = (v) => {
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return /** @type {string | number | boolean | null} */ (v);
};

const same = (a, b) => {
  const x = normalize(a ?? null);
  const y = normalize(b ?? null);
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) <= NUMERIC_TOLERANCE;
  return x === y;
};

/**
 * @param {Record<string, unknown>} row
 * @param {DataPoint["key"]} key
 */
export const rowMatchesKey = (row, key) => Object.entries(key).every(([k, v]) => k in row && same(row[k], v));

/**
 * Look a cited point up in the current view rows.
 * match: the row exists and the value is unchanged; changed: the row exists with a new
 * value; missing: no such row (or the column is gone, or the value is now suppressed).
 * @param {DataPoint} point
 * @param {Partial<Record<ViewName, Record<string, unknown>[]>>} rowsByView
 * @returns {{ status: "match" | "changed" | "missing", current: unknown, row: Record<string, unknown> | null }}
 */
export function resolveEvidence(point, rowsByView) {
  const rows = rowsByView[/** @type {ViewName} */ (point.view)] ?? [];
  const matches = rows.filter((r) => rowMatchesKey(r, point.key));
  if (matches.length !== 1) return { status: "missing", current: null, row: null };
  const [row] = matches;
  const current = normalize(row[point.field] ?? null);
  if (!(point.field in row) || current === null) return { status: "missing", current, row };
  return { status: same(current, point.value) ? "match" : "changed", current, row };
}

/**
 * @param {unknown} value
 * @param {ValueFormat} format
 */
export function formatValue(value, format) {
  if (value === null || value === undefined) return "n/a";
  if (format === "pct") return `${Math.round(Number(value) * 100)}%`;
  if (format === "int") return Math.round(Number(value)).toLocaleString("en-US");
  if (format === "bool") return value ? "yes" : "no";
  return String(value);
}

/** Human-readable source, used as the hover text for each evidence item. */
export function describeSource(/** @type {DataPoint} */ point) {
  const where = Object.entries(point.key)
    .map(([k, v]) => `${k} ${v === null ? "is null" : `= ${typeof v === "string" ? `'${v}'` : v}`}`)
    .join(" and ");
  return `fow.${point.view} where ${where}; column ${point.field}`;
}

const ADOPTION_FIELDS = new Set(["weekly_active_rate", "weekly_active_rate_licensed", "licensed_rate", "shadow_ai_rate", "licensed_employees", "weekly_active_users"]);

/**
 * The screen that shows a cited row, or null when the row is shown on the Action plan itself.
 * @param {DataPoint} point
 * @param {Record<string, unknown> | null} row  the current row, for columns not in the key
 */
export function evidenceHref(point, row = null) {
  const fn = /** @type {string | null} */ (point.key.function_name ?? row?.function_name ?? null);
  const withFunction = (path) => (fn ? `${path}?function=${encodeURIComponent(fn)}` : path);
  switch (point.view) {
    case "v_function_exposure":
      return withFunction("/exposure");
    case "v_exposure_adoption":
      return withFunction(ADOPTION_FIELDS.has(point.field) ? "/adoption" : "/exposure");
    case "v_job_exposure":
      return fn ? `${withFunction("/exposure")}&job=${encodeURIComponent(String(point.key.job_key))}` : "/exposure";
    case "v_adoption_manager":
    case "v_pulse_sentiment":
      return withFunction("/adoption");
    case "v_register":
      return "/governance";
    default:
      return null;
  }
}

/**
 * Check one stored recommendation against the current view rows.
 * @param {{ evidence: DataPoint[] }} recommendation
 * @param {Partial<Record<ViewName, Record<string, unknown>[]>>} rowsByView
 */
export function checkRecommendation(recommendation, rowsByView) {
  const items = recommendation.evidence.map((point) => ({ point, ...resolveEvidence(point, rowsByView) }));
  const metrics = items.filter((i) => i.point.kind === "metric");
  const metricsFound = metrics.filter((i) => i.status !== "missing").length;
  return {
    items,
    metrics: metrics.length,
    metricsFound,
    metricsMatching: metrics.filter((i) => i.status === "match").length,
    passes: metricsFound >= MIN_METRIC_EVIDENCE,
  };
}
