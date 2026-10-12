// Job task time shares and exposure math. The views in supabase/migrations do the
// same roll-up in SQL; these functions are the reference the tests check by hand.
import { EXPOSURE_BY_LABEL } from "./rubric.mjs";

const SCALE = 1_000_000; // job_tasks.time_share is numeric(8, 6)

/**
 * Split one job's time across its tasks: importance x frequency, normalized to 1.
 * Tasks without both ratings (custom tasks from an upload) make the job fall back to
 * equal shares. Shares are rounded to 6 decimals and the rounding remainder goes to
 * the largest share, so every job sums to exactly 1.000000.
 *
 * @param {Array<{ task_id: number, importance: number | null, frequency: number | null }>} tasks
 * @returns {Array<{ task_id: number, time_share: number }>}
 */
export const timeShares = (tasks) => {
  if (tasks.length === 0) return [];
  const weights = tasks.map((t) =>
    t.importance > 0 && t.frequency > 0 ? t.importance * t.frequency : null
  );
  const rated = weights.every((w) => w !== null);
  const total = rated ? weights.reduce((a, b) => a + b, 0) : tasks.length;

  const units = tasks.map((_, i) =>
    Math.max(1, Math.round(((rated ? weights[i] : 1) / total) * SCALE))
  );
  const remainder = SCALE - units.reduce((a, b) => a + b, 0);
  const largest = units.indexOf(Math.max(...units));
  units[largest] += remainder;

  return tasks.map((t, i) => ({ task_id: t.task_id, time_share: units[i] / SCALE }));
};

/**
 * Build fow.job_tasks rows for a dataset from its jobs and the O*NET tasks of each
 * job's occupation.
 *
 * @param {string} datasetId
 * @param {Array<{ job_key: string, onetsoc_code: string | null }>} jobs
 * @param {Array<{ task_id: number, onetsoc_code: string, importance: number | null, frequency: number | null }>} tasks
 */
export const buildJobTasks = (datasetId, jobs, tasks) => {
  /** @type {Map<string, typeof tasks>} */
  const byCode = new Map();
  for (const t of tasks) {
    const list = byCode.get(t.onetsoc_code) ?? [];
    list.push(t);
    byCode.set(t.onetsoc_code, list);
  }

  const rows = [];
  const unmapped = [];
  for (const job of jobs) {
    const jobTasks = job.onetsoc_code ? byCode.get(job.onetsoc_code) ?? [] : [];
    if (jobTasks.length === 0) {
      unmapped.push(job.job_key);
      continue;
    }
    const sorted = [...jobTasks].sort((a, b) => a.task_id - b.task_id);
    for (const share of timeShares(sorted)) {
      rows.push({ dataset_id: datasetId, job_key: job.job_key, ...share });
    }
  }
  return { rows, unmapped };
};

/**
 * Job exposure = sum of time_share x exposure, with the automate/augment split.
 * Unscored tasks count toward nothing, as in fow.job_exposure_base.
 *
 * @param {Array<{ task_id: number, time_share: number }>} jobTasks
 * @param {Map<number, keyof typeof EXPOSURE_BY_LABEL>} labels task_id -> label
 */
export const jobExposure = (jobTasks, labels) => {
  let automate = 0;
  let augment = 0;
  let exposure = 0;
  for (const { task_id, time_share } of jobTasks) {
    const label = labels.get(task_id);
    if (!label) continue;
    if (label === "automate") automate += time_share;
    if (label === "augment") augment += time_share;
    exposure += time_share * EXPOSURE_BY_LABEL[label];
  }
  return { automate_share: automate, augment_share: augment, exposed_share: automate + augment, exposure_score: exposure };
};

/**
 * Weighted average of a per-job measure, by headcount or labor cost.
 * @param {Array<{ value: number | null, headcount: number, labor_cost_usd: number }>} jobs
 * @param {"headcount" | "labor_cost_usd"} weight
 */
export const weightedRollup = (jobs, weight) => {
  const scored = jobs.filter((j) => j.value !== null);
  const total = scored.reduce((a, j) => a + j[weight], 0);
  return total > 0 ? scored.reduce((a, j) => a + j[weight] * j.value, 0) / total : null;
};
