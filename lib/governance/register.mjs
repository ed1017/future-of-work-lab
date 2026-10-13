// Pure helpers for the governance screen: filtering, ordering, and the overdue count.

const TIER_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * @param {Array<Record<string, any>>} rows  fow.v_register rows
 * @param {{ tier?: string | null, status?: string | null, review?: string | null }} filters
 */
export function filterRegister(rows, { tier = null, status = null, review = null } = {}) {
  return rows.filter(
    (r) =>
      (!tier || (tier === "unassessed" ? r.risk_tier === null : r.risk_tier === tier)) &&
      (!status || r.status === status) &&
      (!review || (review === "flagged" ? r.is_overdue || r.bias_audit_due : r.review_status === review)),
  );
}

/** Overdue first, then bias audits due, then highest risk, then name. */
export function sortRegister(rows) {
  return [...rows].sort(
    (a, b) =>
      Number(b.is_overdue) - Number(a.is_overdue) ||
      Number(b.bias_audit_due) - Number(a.bias_audit_due) ||
      (TIER_ORDER[a.risk_tier] ?? 3) - (TIER_ORDER[b.risk_tier] ?? 3) ||
      a.name.localeCompare(b.name),
  );
}

export function registerSummary(rows) {
  return {
    total: rows.length,
    highRisk: rows.filter((r) => r.risk_tier === "high").length,
    overdue: rows.filter((r) => r.is_overdue).length,
    biasAuditDue: rows.filter((r) => r.bias_audit_due).length,
    notReviewed: rows.filter((r) => r.review_status === "Not reviewed").length,
  };
}

/** Whole days between the review date and today; positive = overdue by that many days. */
export function daysOverdue(nextReviewDate, today = new Date()) {
  if (!nextReviewDate) return null;
  const due = Date.parse(`${nextReviewDate}T00:00:00Z`);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((now - due) / 86_400_000);
}
