import { z } from "zod";

// Validation for register edits. The database has the same checks; this gives the
// admin a readable message before a write is attempted.

export const DECISION_IMPACT = ["none", "informs", "determines"];
export const USE_CASE_STATUS = ["proposed", "pilot", "production", "retired"];
export const FRAMEWORKS = ["EU AI Act", "NYC LL 144", "NIST AI RMF", "Internal"];
export const TIERS = ["low", "medium", "high"];
export const REVIEW_STATES = ["draft", "in_review", "approved", "changes_requested"];

const text = (max) => z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.union([z.null(), z.iso.date("Use a valid date")]));
const requiredDate = z.iso.date("Use a valid date");

export const useCaseSchema = z.object({
  name: text(120),
  hr_process: text(80),
  tool_id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.union([z.null(), z.string().regex(/^[a-z0-9-]+$/, "Unknown tool")])),
  decision_impact: z.enum(DECISION_IMPACT),
  owner: text(80),
  human_in_loop: z.enum(["yes", "no"]).transform((v) => v === "yes"),
  status: z.enum(USE_CASE_STATUS),
  description: z
    .string()
    .trim()
    .max(600, "At most 600 characters")
    .transform((v) => (v === "" ? null : v)),
});

export const assessmentSchema = z
  .object({
    use_case_id: z.uuid("Unknown use case"),
    framework: z.enum(FRAMEWORKS),
    tier: z.enum(TIERS),
    rationale: text(600),
    review_state: z.enum(REVIEW_STATES),
    assessed_on: requiredDate,
    bias_audit_date: optionalDate,
    next_review_date: optionalDate,
  })
  .refine((v) => !v.next_review_date || v.next_review_date >= v.assessed_on, {
    path: ["next_review_date"],
    message: "The next review can't be before the assessment date",
  });

/**
 * Readable per-field messages from a failed parse.
 * @param {{ issues: Array<{ path: PropertyKey[], message: string }> }} error
 * @returns {Record<string, string>}
 */
export function fieldErrors(error) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * FormData entries to a plain object of strings, ignoring Next's internal $ACTION keys.
 * @param {FormData} formData
 * @returns {Record<string, string>}
 */
export function formValues(formData) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  }
  return out;
}
