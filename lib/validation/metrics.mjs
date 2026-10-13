// Validation math for the exposure labels: sample draw, agreement, Cohen's kappa, and
// test-retest stability. Pure functions; no database or network.
import { createHash } from "node:crypto";

export const LABELS = /** @type {const} */ (["automate", "augment", "unaffected"]);
export const SAMPLE_SIZE = 100;
export const RETEST_SIZE = 50;
export const SAMPLE_SEED = "fow-validation-v1";

/**
 * How many sample slots each label gets: an equal share, capped at what exists, with
 * unused slots handed to the labels that still have tasks.
 * @param {Record<string, number>} available tasks per label
 * @param {number} total
 */
export function allocate(available, total = SAMPLE_SIZE) {
  /** @type {Record<string, number>} */
  const take = Object.fromEntries(LABELS.map((l) => [l, 0]));
  let left = Math.min(total, LABELS.reduce((s, l) => s + (available[l] ?? 0), 0));
  while (left > 0) {
    const open = LABELS.filter((l) => take[l] < (available[l] ?? 0));
    const share = Math.max(1, Math.floor(left / open.length));
    for (const l of open) {
      if (left <= 0) break;
      const add = Math.min(share, (available[l] ?? 0) - take[l], left);
      take[l] += add;
      left -= add;
    }
  }
  return take;
}

const rank = (seed, taskId) => createHash("sha256").update(`${seed}:${taskId}`).digest("hex");

/**
 * Stratified draw by model label. Within a label tasks are chosen by a seeded hash, so
 * the draw is reproducible. Positions interleave the labels (automate, augment,
 * unaffected, automate, ...), so the first 50 are stratified as well.
 * @param {{ run_id: string, task_id: number, label: string }[]} scores latest score per task
 */
export function drawSample(scores, { size = SAMPLE_SIZE, seed = SAMPLE_SEED } = {}) {
  /** @type {Record<string, typeof scores>} */
  const byLabel = Object.fromEntries(LABELS.map((l) => [l, []]));
  for (const s of scores) byLabel[s.label]?.push(s);
  const take = allocate(Object.fromEntries(LABELS.map((l) => [l, byLabel[l].length])), size);
  const picked = Object.fromEntries(
    LABELS.map((l) => [l, [...byLabel[l]].sort((a, b) => rank(seed, a.task_id).localeCompare(rank(seed, b.task_id))).slice(0, take[l])]),
  );
  const rows = [];
  for (let i = 0; rows.length < size; i++) {
    let any = false;
    for (const l of LABELS) {
      const s = picked[l][i];
      if (!s) continue;
      any = true;
      rows.push({ run_id: s.run_id, task_id: s.task_id, stratum: l, stratum_size: byLabel[l].length, position: rows.length + 1 });
    }
    if (!any) break;
  }
  return rows;
}

/** The reviewer's label: the model's when they agree, otherwise their override. */
export const reviewerLabel = (review, modelLabel) => (review.agrees ? modelLabel : review.override_label);

/** Blind labeling: the reviewer picks a label; whether it agrees is derived from it. */
export const reviewFromLabel = (chosen, modelLabel) => ({ agrees: chosen === modelLabel, override_label: chosen === modelLabel ? null : chosen });

/**
 * Cohen's kappa between two label lists. Null when undefined (no pairs, or both raters
 * used one identical label throughout, so chance agreement is 1).
 * @param {{ a: string, b: string }[]} pairs
 */
export function cohensKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const po = pairs.filter((p) => p.a === p.b).length / n;
  const pe = LABELS.reduce((sum, l) => sum + (pairs.filter((p) => p.a === l).length / n) * (pairs.filter((p) => p.b === l).length / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

/** Landis and Koch (1977) wording for a kappa value. */
export function kappaBand(k) {
  if (k === null || k === undefined) return null;
  if (k < 0) return "worse than chance";
  if (k <= 0.2) return "slight";
  if (k <= 0.4) return "fair";
  if (k <= 0.6) return "moderate";
  if (k <= 0.8) return "substantial";
  return "almost perfect";
}

const matrix = (pairs) =>
  Object.fromEntries(LABELS.map((m) => [m, Object.fromEntries(LABELS.map((h) => [h, pairs.filter((p) => p.a === m && p.b === h).length]))]));

/**
 * Validation result for the sample.
 * @param {{ task_id: number, stratum: string, stratum_size: number, position: number }[]} sample
 * @param {Map<number, string>} modelLabels task_id -> model label
 * @param {Map<number, { agrees: boolean, override_label: string | null }>} reviews task_id -> review
 */
export function validationSummary(sample, modelLabels, reviews) {
  const pairs = sample.flatMap((s) => {
    const review = reviews.get(s.task_id);
    const model = modelLabels.get(s.task_id);
    const human = review && model ? reviewerLabel(review, model) : null;
    return human && model ? [{ a: model, b: human, stratum: s.stratum, stratum_size: s.stratum_size }] : [];
  });
  const agree = pairs.filter((p) => p.a === p.b).length;
  const kappa = cohensKappa(pairs);
  const perLabel = LABELS.map((l) => {
    const rows = pairs.filter((p) => p.a === l);
    return { label: l, reviewed: rows.length, agreed: rows.filter((p) => p.a === p.b).length, populationSize: sample.find((s) => s.stratum === l)?.stratum_size ?? 0 };
  });
  // Agreement across all scored tasks: each label's agreement rate weighted by how many
  // tasks the model gave that label. Needs every label in the sample to have a review.
  const covered = perLabel.filter((p) => p.reviewed > 0);
  const total = covered.reduce((s, p) => s + p.populationSize, 0);
  const weighted = covered.length === perLabel.filter((p) => p.populationSize > 0).length && total
    ? covered.reduce((s, p) => s + (p.populationSize / total) * (p.agreed / p.reviewed), 0)
    : null;
  return {
    sampleSize: sample.length,
    reviewed: pairs.length,
    complete: sample.length > 0 && pairs.length === sample.length,
    agreed: agree,
    agreement: pairs.length ? agree / pairs.length : null,
    weightedAgreement: weighted,
    kappa,
    kappaBand: kappaBand(kappa),
    perLabel,
    confusion: matrix(pairs),
  };
}

/**
 * Test-retest stability: how often the second pass gives the same label.
 * @param {Map<number, string>} first task_id -> original label
 * @param {Map<number, string>} second task_id -> retest label
 */
export function stabilitySummary(first, second) {
  const pairs = [...second].flatMap(([id, b]) => (first.has(id) ? [{ a: first.get(id), b }] : []));
  const same = pairs.filter((p) => p.a === p.b).length;
  const kappa = cohensKappa(pairs);
  return { tasks: pairs.length, same, stability: pairs.length ? same / pairs.length : null, kappa, kappaBand: kappaBand(kappa), confusion: matrix(pairs) };
}
