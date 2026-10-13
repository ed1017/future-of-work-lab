// Action planner contract: the moves, the zod schemas a model answer must pass, and the
// stored row. Every recommendation cites at least two metric facts it was given, and
// every number in its text must appear in what it cites.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { MIN_METRIC_EVIDENCE } from "./evidence.mjs";

export const PLANNER_VERSION = "v1";
export const PROMPT_PATH = new URL("../../prompts/actions-v1.md", import.meta.url);
export const MAX_TEXT_WORDS = 70;

export const MOVES = /** @type {const} */ (["redesign", "reskill", "redeploy", "hold"]);

/** Shape sent to the model as a strict JSON schema. Rules it cannot express live in recommendationSchema. */
export const wireRecommendationSchema = z.object({
  move: z.enum(MOVES),
  text: z.string(),
  evidence_ids: z.array(z.string()),
  course_ids: z.array(z.string()),
  target_ids: z.array(z.string()),
});

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

/** Numbers as written in text: 24%, 1,333, 0.5 -> "24", "1333", "0.5". */
export const numbersIn = (text) => (String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));

/**
 * Schema for one function's answer, given the facts, courses, and targets offered.
 * @param {ReturnType<typeof import("./facts.mjs").buildFunctionFacts>} offered
 */
export function recommendationSchema(offered) {
  const byId = new Map([...offered.facts, ...offered.courses, ...offered.targets].map((f) => [f.id, f]));
  const ids = (prefix) => new Set([...byId.keys()].filter((id) => id.startsWith(prefix)));
  const factIds = ids("F");
  const courseIds = ids("C");
  const targetIds = ids("T");
  return wireRecommendationSchema
    .extend({
      text: z
        .string()
        .trim()
        .min(1)
        .refine((s) => wordCount(s) <= MAX_TEXT_WORDS, { message: `text must be ${MAX_TEXT_WORDS} words or fewer` }),
    })
    .superRefine((r, ctx) => {
      const issue = (message) => ctx.addIssue({ code: "custom", message });
      const unique = (list, name) => {
        if (new Set(list).size !== list.length) issue(`duplicate ${name}`);
      };
      unique(r.evidence_ids, "evidence_ids");
      unique(r.course_ids, "course_ids");
      unique(r.target_ids, "target_ids");
      for (const id of r.evidence_ids) if (!factIds.has(id)) issue(`unknown evidence id ${id}`);
      for (const id of r.course_ids) if (!courseIds.has(id)) issue(`unknown course id ${id}`);
      for (const id of r.target_ids) if (!targetIds.has(id)) issue(`unknown target id ${id}`);
      if (new Set(r.evidence_ids.filter((id) => factIds.has(id))).size < MIN_METRIC_EVIDENCE) {
        issue(`cite at least ${MIN_METRIC_EVIDENCE} evidence ids`);
      }
      if (r.move === "redeploy" && r.target_ids.length === 0) issue("a redeploy move needs at least one target id");
      const cited = [...r.evidence_ids, ...r.course_ids, ...r.target_ids].map((id) => byId.get(id)).filter(Boolean);
      const allowed = new Set(cited.flatMap((f) => [...numbersIn(f.display), ...numbersIn(f.label)]));
      for (const n of numbersIn(r.text)) {
        if (!allowed.has(n)) issue(`the number ${n} in text is not in the cited evidence`);
      }
    });
}

/**
 * The fow.action_recommendations row for one validated answer.
 * @param {{
 *   datasetId: string,
 *   offered: ReturnType<typeof import("./facts.mjs").buildFunctionFacts>,
 *   answer: z.infer<typeof wireRecommendationSchema>,
 *   model: string,
 *   runId: string | null,
 *   promptSha: string,
 *   createdAt: string,
 * }} args
 */
export function toRecommendationRow({ datasetId, offered, answer, model, runId, promptSha, createdAt }) {
  const byId = new Map([...offered.facts, ...offered.courses, ...offered.targets].map((f) => [f.id, f]));
  const evidence = [...answer.evidence_ids, ...answer.course_ids, ...answer.target_ids].map((id) => {
    const f = /** @type {NonNullable<ReturnType<typeof byId.get>>} */ (byId.get(id));
    return { view: f.view, key: f.key, field: f.field, value: f.value, label: f.label, format: f.format, kind: f.kind };
  });
  return {
    run_id: runId,
    dataset_id: datasetId,
    scope_key: offered.function,
    move: answer.move,
    text: answer.text.trim(),
    evidence,
    model,
    prompt_sha: promptSha,
    created_at: createdAt,
  };
}

/** What the model sees for one function: ids, labels, and display values only. */
export function plannerInput(offered) {
  return {
    function: offered.function,
    facts: offered.facts.map((f) => ({ id: f.id, label: f.label, value: f.display })),
    courses: offered.courses.map((c) => ({ id: c.id, course: c.display, detail: c.label })),
    redeployment_targets: offered.targets.map((t) => ({ id: t.id, move: t.label })),
  };
}

export const loadPrompt = async () => {
  const text = await readFile(PROMPT_PATH, "utf8");
  return { text, sha: createHash("sha256").update(text).digest("hex") };
};
