// Pure transforms from the fow view rows to everything the Overview and Exposure
// screens show. No I/O here, so tests can check every value against the SQL in
// tests/fixtures/overview/queries.sql.

/** @typedef {"cost" | "headcount"} Weighting */

/**
 * @typedef {object} FunctionExposureRow  fow.v_function_exposure
 * @property {string | null} function_name
 * @property {boolean} is_total
 * @property {boolean} suppressed
 * @property {number | null} headcount
 * @property {number | null} automate_share_hc
 * @property {number | null} augment_share_hc
 * @property {number | null} exposed_share_hc
 * @property {number | null} exposure_score_hc
 * @property {number | null} automate_share_cost
 * @property {number | null} augment_share_cost
 * @property {number | null} exposed_share_cost
 * @property {number | null} exposure_score_cost
 */

/**
 * @typedef {object} AdoptionRow  fow.v_exposure_adoption
 * @property {"company" | "function" | "family"} level
 * @property {string | null} function_name
 * @property {string | null} family_name
 * @property {boolean} suppressed
 * @property {number | null} headcount
 * @property {number | null} exposure_score_hc
 * @property {number | null} exposure_score_cost
 * @property {number | null} licensed_employees
 * @property {number | null} weekly_active_users
 * @property {number | null} weekly_active_rate
 * @property {number | null} weekly_active_rate_licensed
 * @property {number | null} licensed_rate
 * @property {number | null} shadow_ai_rate
 * @property {string | null} week_start
 */

/**
 * @typedef {object} JobExposureRow  fow.v_job_exposure
 * @property {string} job_key
 * @property {string} title
 * @property {string} function_name
 * @property {string} family_name
 * @property {boolean} suppressed
 * @property {number | null} headcount
 * @property {number | null} automate_share
 * @property {number | null} augment_share
 * @property {number | null} exposed_share
 * @property {number | null} exposure_score
 */

/**
 * @typedef {object} RegisterRow  fow.v_register
 * @property {string} use_case_id
 * @property {string} name
 * @property {string | null} risk_tier
 * @property {string | null} owner
 * @property {boolean | null} human_in_loop
 * @property {string} review_status
 * @property {boolean} is_overdue
 * @property {string} hr_process
 * @property {string | null} tool_id
 * @property {string | null} tool_name
 * @property {boolean | null} tool_approved
 * @property {string} decision_impact
 * @property {string} status
 * @property {string[] | null} frameworks
 * @property {string | null} next_review_date
 * @property {string | null} bias_audit_date
 * @property {boolean} bias_audit_due
 */

/**
 * @typedef {object} OverviewData
 * @property {FunctionExposureRow[]} functionExposure
 * @property {AdoptionRow[]} adoption
 * @property {JobExposureRow[]} jobs
 * @property {RegisterRow[]} register
 */

/** Jobs at or above this exposure score are flagged for redesign. */
export const REDESIGN_EXPOSURE_THRESHOLD = 0.65;

/** Bubbles labeled on the quadrant; the rest show on hover. */
export const QUADRANT_LABEL_COUNT = 8;

/** @param {unknown} value @returns {Weighting} */
export const normalizeWeighting = (value) => (value === "headcount" ? "headcount" : "cost");

/** @param {Weighting} weighting */
const suffix = (weighting) => (weighting === "cost" ? "cost" : "hc");

/** @param {unknown} v @returns {number | null} */
const num = (v) => (v === null || v === undefined ? null : Number(v));

const TIER_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * One bar per function: automate and augment shares of task time (exposed = both),
 * sorted by exposed share, largest first. Suppressed functions go last with no values.
 * @param {FunctionExposureRow[]} functionExposure
 * @param {Weighting} weighting
 */
export function functionBars(functionExposure, weighting) {
  const s = suffix(weighting);
  return functionExposure
    .filter((r) => !r.is_total)
    .map((r) => {
      const hidden = r.suppressed || r.headcount === null;
      return {
        function: /** @type {string} */ (r.function_name),
        suppressed: hidden,
        headcount: num(r.headcount),
        automate: hidden ? null : num(r[`automate_share_${s}`]),
        augment: hidden ? null : num(r[`augment_share_${s}`]),
        exposed: hidden ? null : num(r[`exposed_share_${s}`]),
        score: hidden ? null : num(r[`exposure_score_${s}`]),
      };
    })
    .sort((a, b) => {
      if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
      return (b.exposed ?? 0) - (a.exposed ?? 0) || a.function.localeCompare(b.function);
    });
}

/**
 * @param {AdoptionRow} companyRow
 * @param {number} x
 * @param {number} y
 */
const zoneOf = (companyRow, weighting, x, y) => {
  const xMid = num(companyRow.weekly_active_rate) ?? 0;
  const yMid = num(companyRow[`exposure_score_${suffix(weighting)}`]) ?? 0;
  const highExposure = y >= yMid;
  const highAdoption = x >= xMid;
  if (highExposure) return highAdoption ? "Govern & scale" : "Enable first";
  return highAdoption ? "Check for shadow AI" : "Monitor";
};

/**
 * Exposure x adoption by job family. The dividing lines are the company values, so a
 * bubble sits "top-left" when its family is more exposed and less adopted than the company.
 * @param {AdoptionRow[]} adoption
 * @param {Weighting} weighting
 * @param {string | null} functionName
 */
export function quadrant(adoption, weighting, functionName = null) {
  const company = adoption.find((r) => r.level === "company");
  const s = suffix(weighting);
  const families = adoption.filter(
    (r) => r.level === "family" && (!functionName || r.function_name === functionName),
  );
  const points = [];
  let hidden = 0;
  for (const r of families) {
    const x = num(r.weekly_active_rate);
    const y = num(r[`exposure_score_${s}`]);
    if (r.suppressed || x === null || y === null || !company) {
      hidden += 1;
      continue;
    }
    points.push({
      key: `${r.function_name}/${r.family_name}`,
      function: /** @type {string} */ (r.function_name),
      family: /** @type {string} */ (r.family_name),
      x,
      y,
      headcount: /** @type {number} */ (num(r.headcount)),
      zone: zoneOf(company, weighting, x, y),
    });
  }
  points.sort((a, b) => b.headcount - a.headcount || a.key.localeCompare(b.key));
  return {
    points,
    hiddenFamilies: hidden,
    xMid: company ? num(company.weekly_active_rate) : null,
    yMid: company ? num(company[`exposure_score_${s}`]) : null,
    labeledKeys: points.slice(0, QUADRANT_LABEL_COUNT).map((p) => p.key),
  };
}

/**
 * Register preview: highest risk first, overdue first within a tier.
 * @param {RegisterRow[]} register
 */
export function registerPreview(register, limit = 5) {
  const rows = [...register].sort(
    (a, b) =>
      (TIER_ORDER[/** @type {"high"} */ (a.risk_tier ?? "")] ?? 3) -
        (TIER_ORDER[/** @type {"high"} */ (b.risk_tier ?? "")] ?? 3) ||
      Number(b.is_overdue) - Number(a.is_overdue) ||
      a.name.localeCompare(b.name),
  );
  return rows.slice(0, limit);
}

/**
 * @param {OverviewData} data
 * @param {{ functionName?: string | null, weighting?: Weighting }} [options]
 */
export function buildOverview(data, { functionName = null, weighting = "cost" } = {}) {
  const s = suffix(weighting);
  const exposureRow = functionName
    ? data.functionExposure.find((r) => !r.is_total && r.function_name === functionName)
    : data.functionExposure.find((r) => r.is_total);
  const adoptionRow = functionName
    ? data.adoption.find((r) => r.level === "function" && r.function_name === functionName)
    : data.adoption.find((r) => r.level === "company");

  const scopedJobs = data.jobs.filter((j) => !functionName || j.function_name === functionName);
  const flagged = scopedJobs.filter(
    (j) => j.exposure_score !== null && Number(j.exposure_score) >= REDESIGN_EXPOSURE_THRESHOLD,
  );

  return {
    weighting,
    functionName,
    kpis: {
      exposure: {
        value: exposureRow?.suppressed ? null : num(exposureRow?.[`exposure_score_${s}`]),
        suppressed: Boolean(exposureRow?.suppressed),
      },
      adoption: {
        rate: num(adoptionRow?.weekly_active_rate_licensed),
        activeUsers: num(adoptionRow?.weekly_active_users),
        licensed: num(adoptionRow?.licensed_employees),
        suppressed: Boolean(adoptionRow?.suppressed),
      },
      useCases: {
        total: data.register.length,
        highRisk: data.register.filter((r) => r.risk_tier === "high").length,
        overdue: data.register.filter((r) => r.is_overdue).length,
      },
      redesign: {
        roles: flagged.length,
        employees: flagged.reduce((sum, j) => sum + (num(j.headcount) ?? 0), 0),
        suppressedRoles: flagged.filter((j) => j.suppressed).length,
        threshold: REDESIGN_EXPOSURE_THRESHOLD,
      },
    },
    bars: functionBars(data.functionExposure, weighting),
    quadrant: quadrant(data.adoption, weighting, functionName),
    register: registerPreview(data.register),
  };
}

/**
 * Function -> family -> job drill-down for /exposure.
 * @param {OverviewData} data
 * @param {{ functionName?: string | null, weighting?: Weighting }} [options]
 */
export function buildExposureDrilldown(data, { functionName = null, weighting = "cost" } = {}) {
  const s = suffix(weighting);
  const bars = functionBars(data.functionExposure, weighting);
  if (!functionName) return { bars, families: [] };

  const familyRows = data.adoption.filter(
    (r) => r.level === "family" && r.function_name === functionName,
  );
  const families = familyRows
    .map((f) => {
      const jobs = data.jobs
        .filter((j) => j.function_name === functionName && j.family_name === f.family_name)
        .map((j) => ({
          jobKey: j.job_key,
          title: j.title,
          suppressed: j.suppressed,
          headcount: num(j.headcount),
          automate: num(j.automate_share),
          augment: num(j.augment_share),
          exposed: num(j.exposed_share),
          score: num(j.exposure_score),
        }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));
      return {
        family: /** @type {string} */ (f.family_name),
        suppressed: f.suppressed,
        headcount: num(f.headcount),
        score: f.suppressed ? null : num(f[`exposure_score_${s}`]),
        jobs,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.family.localeCompare(b.family));
  return { bars, families };
}

/**
 * Latest succeeded score per task (newest finished run wins), as v_job_exposure does.
 * @param {{ task_id: number, label: string, exposure: number, confidence: string, rationale: string,
 *   run: { status: string, finished_at: string | null, started_at: string } }[]} rows
 */
export function latestScores(rows) {
  const stamp = (/** @type {{ finished_at: string | null, started_at: string }} */ run) =>
    Date.parse(run.finished_at ?? run.started_at);
  /** @type {Map<number, (typeof rows)[number]>} */
  const best = new Map();
  for (const row of rows) {
    if (row.run.status !== "succeeded") continue;
    const current = best.get(row.task_id);
    if (!current || stamp(row.run) > stamp(current.run)) best.set(row.task_id, row);
  }
  return best;
}

/**
 * Task list for one job with its label, rationale and confidence, plus the job's
 * exposure recomputed as sum(time_share x exposure) so the page can show its working.
 * @param {{ task_id: number, time_share: number, task_text: string }[]} jobTasks
 * @param {ReturnType<typeof latestScores>} scores
 */
export function jobTaskDetail(jobTasks, scores) {
  const tasks = jobTasks
    .map((t) => {
      const s = scores.get(t.task_id);
      return {
        taskId: t.task_id,
        text: t.task_text,
        timeShare: Number(t.time_share),
        label: s?.label ?? null,
        exposure: s ? Number(s.exposure) : null,
        confidence: s?.confidence ?? null,
        rationale: s?.rationale ?? null,
      };
    })
    .sort((a, b) => b.timeShare - a.timeShare || a.taskId - b.taskId);
  const scored = tasks.filter((t) => t.exposure !== null);
  return {
    tasks,
    exposureScore: scored.length ? scored.reduce((sum, t) => sum + t.timeShare * (t.exposure ?? 0), 0) : null,
    coverage: scored.reduce((sum, t) => sum + t.timeShare, 0),
  };
}
