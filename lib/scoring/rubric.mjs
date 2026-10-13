// Exposure rubric v1 (docs/SPEC.md, "Exposure scoring pipeline") and the zod
// schemas that every model response must pass before it is stored.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const RUBRIC_VERSION = "v1";
export const PROMPT_PATH = new URL("../../prompts/exposure-v1.md", import.meta.url);
export const BATCH_SIZE = 25;
export const MAX_RATIONALE_WORDS = 40;

/** Exposure value for each label. */
export const EXPOSURE_BY_LABEL = { automate: 1, augment: 0.5, unaffected: 0 };

export const LABELS = /** @type {const} */ (["automate", "augment", "unaffected"]);
export const CONFIDENCE = /** @type {const} */ (["low", "medium", "high"]);

export const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

/** Shape sent to the model as a strict JSON schema. Rules it cannot express live in taskScoreSchema. */
export const wireResponseSchema = z.object({
  scores: z.array(
    z.object({
      task_id: z.number().int(),
      label: z.enum(LABELS),
      exposure: z.number(),
      confidence: z.enum(CONFIDENCE),
      rationale: z.string(),
    })
  ),
});

export const taskScoreSchema = z
  .object({
    task_id: z.number().int().positive(),
    label: z.enum(LABELS),
    exposure: z.number().min(0).max(1),
    confidence: z.enum(CONFIDENCE),
    rationale: z
      .string()
      .trim()
      .min(1)
      .refine((s) => wordCount(s) <= MAX_RATIONALE_WORDS, {
        message: `rationale must be ${MAX_RATIONALE_WORDS} words or fewer`,
      }),
  })
  .refine((s) => s.exposure === EXPOSURE_BY_LABEL[s.label], {
    message: "exposure must be the rubric value for the label",
    path: ["exposure"],
  });

/**
 * Schema for one batch: every requested task scored exactly once, nothing else.
 * @param {number[]} taskIds
 */
export const batchResponseSchema = (taskIds) => {
  const expected = new Set(taskIds);
  return z
    .object({ scores: z.array(taskScoreSchema) })
    .superRefine(({ scores }, ctx) => {
      const seen = new Set();
      for (const s of scores) {
        if (!expected.has(s.task_id)) {
          ctx.addIssue({ code: "custom", message: `unexpected task_id ${s.task_id}` });
        } else if (seen.has(s.task_id)) {
          ctx.addIssue({ code: "custom", message: `duplicate task_id ${s.task_id}` });
        }
        seen.add(s.task_id);
      }
      for (const id of expected) {
        if (!seen.has(id)) ctx.addIssue({ code: "custom", message: `missing task_id ${id}` });
      }
    });
};

export const loadPrompt = async () => {
  const text = await readFile(PROMPT_PATH, "utf8");
  return { text, sha: createHash("sha256").update(text).digest("hex") };
};
