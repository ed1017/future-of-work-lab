// Pure transforms from the fow adoption views to the Adoption screen. No I/O.

/**
 * @typedef {import("../overview/metrics.mjs").AdoptionRow} AdoptionRow
 * @typedef {{ function: string, suppressed: boolean, headcount: number | null, weeklyActiveRate: number | null, licensedRate: number | null, weeklyActiveRateLicensed: number | null, shadowRate: number | null }} FunctionAdoption
 * @typedef {{ function: string, family: string, headcount: number | null, exposure: number, weeklyActiveRate: number, gap: number }} EnableFirstRow
 */

/** @param {unknown} v @returns {number | null} */
const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Function rows with their weekly active rate (share of headcount), highest first.
 * @param {AdoptionRow[]} adoption
 */
export function adoptionByFunction(adoption) {
  const company = adoption.find((r) => r.level === "company");
  const rows = adoption
    .filter((r) => r.level === "function")
    .map((r) => ({
      function: r.function_name,
      suppressed: r.suppressed,
      headcount: r.headcount,
      weeklyActiveRate: num(r.weekly_active_rate),
      licensedRate: num(r.licensed_rate),
      weeklyActiveRateLicensed: num(r.weekly_active_rate_licensed),
      shadowRate: num(r.shadow_ai_rate),
    }))
    .sort((a, b) => (b.weeklyActiveRate ?? -1) - (a.weeklyActiveRate ?? -1) || a.function.localeCompare(b.function));
  return {
    company: company
      ? {
          weeklyActiveRate: num(company.weekly_active_rate),
          licensedRate: num(company.licensed_rate),
          shadowRate: num(company.shadow_ai_rate),
          headcount: company.headcount,
          weekStart: company.week_start,
        }
      : null,
    rows,
  };
}

/** Manager teams (already limited to 10+ people by the view), best adoption first. */
export function managerTeams(managers) {
  return [...managers]
    .map((m) => ({
      label: `${m.function_name} · Team ${m.team_number}`,
      headcount: m.headcount,
      weeklyActiveRate: num(m.weekly_active_rate),
      licensedRate: num(m.licensed_rate),
    }))
    .sort((a, b) => b.weeklyActiveRate - a.weeklyActiveRate || a.label.localeCompare(b.label));
}

/** Tool mix: approved tools by active users, then unapproved (shadow AI). */
export function toolMix(tools) {
  return [...tools].sort(
    (a, b) =>
      Number(b.approved) - Number(a.approved) ||
      (b.weekly_active_users ?? -1) - (a.weekly_active_users ?? -1) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Latest-wave company favorable rate per question, with the change from the previous wave.
 * @param {Array<Record<string, any>>} pulse
 */
export function pulseSummary(pulse) {
  const company = pulse.filter((r) => r.level === "company");
  const waves = [...new Set(company.map((r) => r.response_date))].sort();
  const latest = waves.at(-1) ?? null;
  const previous = waves.at(-2) ?? null;
  const questions = [...new Set(company.map((r) => r.question_code))];
  const at = (q, date) => company.find((r) => r.question_code === q && r.response_date === date);
  return {
    latest,
    previous,
    rows: questions
      .map((q) => {
        const now = at(q, latest);
        const before = previous ? at(q, previous) : undefined;
        return {
          code: q,
          text: now?.question_text ?? before?.question_text ?? q,
          favorable: num(now?.favorable_rate),
          respondents: now?.respondents ?? null,
          change:
            now && before && now.favorable_rate !== null && before.favorable_rate !== null
              ? Number(now.favorable_rate) - Number(before.favorable_rate)
              : null,
        };
      })
      .sort((a, b) => a.text.localeCompare(b.text)),
  };
}

/**
 * Enable-first list: job families more exposed and less adopted than the company
 * (same rule as the Overview quadrant). Most exposed first. Suppressed families are left out.
 * @param {AdoptionRow[]} adoption  fow.v_exposure_adoption rows
 * @param {"cost" | "headcount"} weighting
 * @returns {{ yMid: number | null, xMid: number | null, rows: EnableFirstRow[] }}
 */
export function enableFirst(adoption, weighting = "cost") {
  const key = weighting === "cost" ? "exposure_score_cost" : "exposure_score_hc";
  const company = adoption.find((r) => r.level === "company");
  const yMid = num(company?.[key]);
  const xMid = num(company?.weekly_active_rate);
  if (yMid === null || xMid === null) return { yMid, xMid, rows: [] };
  const rows = adoption
    .filter((r) => r.level === "family" && !r.suppressed && num(r[key]) !== null && num(r.weekly_active_rate) !== null)
    .filter((r) => num(r[key]) > yMid && num(r.weekly_active_rate) < xMid)
    .map((r) => ({
      function: r.function_name,
      family: r.family_name,
      headcount: r.headcount,
      exposure: num(r[key]),
      weeklyActiveRate: num(r.weekly_active_rate),
      gap: xMid - num(r.weekly_active_rate),
    }))
    .sort((a, b) => b.exposure - a.exposure || a.family.localeCompare(b.family));
  return { yMid, xMid, rows };
}
