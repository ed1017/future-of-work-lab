// Pure transforms from fow.action_recommendations and the cited views to the Action plan
// screen and the Overview's top actions. No I/O here.
import { checkRecommendation, describeSource, evidenceHref, formatValue } from "./evidence.mjs";

/**
 * @typedef {import("./evidence.mjs").DataPoint} DataPoint
 * @typedef {object} RecommendationRow  fow.action_recommendations
 * @property {string} scope_key
 * @property {string} move
 * @property {string} text
 * @property {DataPoint[]} evidence
 * @property {string | null} model
 * @property {string | null} [prompt_sha]
 * @property {string | null} [run_id]
 * @property {string} created_at
 */

/** Most urgent first. */
export const MOVE_ORDER = ["redesign", "redeploy", "reskill", "hold"];

const moveRank = (move) => {
  const i = MOVE_ORDER.indexOf(move);
  return i === -1 ? MOVE_ORDER.length : i;
};

/**
 * The newest planning batch (rows written together share created_at), one per function.
 * @template {{ created_at: string, scope_key: string }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function latestBatch(rows) {
  if (!rows.length) return [];
  const newest = rows.reduce((max, r) => (Date.parse(r.created_at) > Date.parse(max) ? r.created_at : max), rows[0].created_at);
  const seen = new Set();
  return rows.filter((r) => {
    if (Date.parse(r.created_at) !== Date.parse(newest) || seen.has(r.scope_key)) return false;
    seen.add(r.scope_key);
    return true;
  });
}

/** @param {Record<string, any>[]} functionExposure */
const exposureByFunction = (functionExposure) =>
  new Map(functionExposure.filter((r) => !r.is_total).map((r) => [r.function_name, r.exposure_score_cost === null ? null : Number(r.exposure_score_cost)]));

/**
 * Most urgent move first, then the more exposed function.
 * @template {{ move: string, scope_key: string }} T
 * @param {T[]} recs
 * @param {Record<string, any>[]} functionExposure
 */
export function sortPlan(recs, functionExposure) {
  const exposure = exposureByFunction(functionExposure);
  return [...recs].sort(
    (a, b) =>
      moveRank(a.move) - moveRank(b.move) ||
      (exposure.get(b.scope_key) ?? -1) - (exposure.get(a.scope_key) ?? -1) ||
      a.scope_key.localeCompare(b.scope_key),
  );
}

/**
 * The Overview's "Recommended actions": the newest batch's most urgent four.
 * @template {{ move: string, scope_key: string, created_at: string }} T
 * @param {T[]} rows
 * @param {Record<string, any>[]} functionExposure
 */
export const topActions = (rows, functionExposure, limit = 4) => sortPlan(latestBatch(rows), functionExposure).slice(0, limit);

/**
 * Everything the Action plan screen shows for one batch, with each evidence item checked
 * against the current view rows.
 * @param {RecommendationRow[]} rows  all recommendations for the dataset
 * @param {Partial<Record<string, Record<string, unknown>[]>>} rowsByView
 * @param {Record<string, any>[]} functionExposure
 */
export function buildPlan(rows, rowsByView, functionExposure) {
  const batch = sortPlan(latestBatch(rows), functionExposure);
  const plans = batch.map((rec) => {
    const checked = checkRecommendation(rec, rowsByView);
    const items = checked.items.map(({ point, status, current, row }) => ({
      kind: point.kind,
      label: point.label,
      value: formatValue(point.value, point.format),
      current: status === "changed" ? formatValue(current, point.format) : null,
      status,
      source: describeSource(point),
      href: evidenceHref(point, row),
    }));
    return {
      function: rec.scope_key,
      move: rec.move,
      text: rec.text,
      metrics: items.filter((i) => i.kind === "metric"),
      courses: items.filter((i) => i.kind === "course"),
      targets: items.filter((i) => i.kind === "target"),
      passes: checked.passes,
      metricsMatching: checked.metricsMatching,
    };
  });
  const metricItems = plans.flatMap((p) => p.metrics);
  const head = batch[0];
  return {
    plans,
    generatedAt: head?.created_at ?? null,
    model: head?.model ?? null,
    promptSha: head?.prompt_sha ?? null,
    moves: MOVE_ORDER.map((move) => ({ move, count: plans.filter((p) => p.move === move).length })),
    evidence: {
      total: metricItems.length,
      matching: metricItems.filter((i) => i.status === "match").length,
      changed: metricItems.filter((i) => i.status === "changed").length,
      missing: metricItems.filter((i) => i.status === "missing").length,
    },
    allPass: plans.length > 0 && plans.every((p) => p.passes),
  };
}
