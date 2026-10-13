// Batching, the model call for one batch, and run cost.
import { zodTextFormat } from "openai/helpers/zod";
import { BATCH_SIZE, batchResponseSchema, wireResponseSchema } from "./rubric.mjs";

/**
 * Group tasks by occupation, then split each occupation into near-equal batches of
 * at most `size`, so the model always sees tasks from one occupation with its job titles.
 *
 * @param {Array<{ task_id: number, onetsoc_code: string, task_text: string }>} tasks
 * @param {Map<string, string[]>} titlesByCode job titles at this company per O*NET code
 */
export const makeBatches = (tasks, titlesByCode, size = BATCH_SIZE) => {
  /** @type {Map<string, typeof tasks>} */
  const byCode = new Map();
  for (const t of [...tasks].sort((a, b) => a.task_id - b.task_id)) {
    const list = byCode.get(t.onetsoc_code) ?? [];
    list.push(t);
    byCode.set(t.onetsoc_code, list);
  }
  const batches = [];
  for (const [code, list] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = Math.ceil(list.length / size);
    const per = Math.ceil(list.length / parts);
    for (let i = 0; i < list.length; i += per) {
      batches.push({
        onetsoc_code: code,
        job_titles: titlesByCode.get(code) ?? [],
        tasks: list.slice(i, i + per).map((t) => ({ task_id: t.task_id, task: t.task_text })),
      });
    }
  }
  return batches;
};

/**
 * Prices in USD per million tokens, from OPENAI_PRICE_INPUT_PER_1M and
 * OPENAI_PRICE_OUTPUT_PER_1M. Required: a run without a cost would fail milestone 3.
 */
export const readPrices = (env) => {
  const input = Number(env.OPENAI_PRICE_INPUT_PER_1M);
  const output = Number(env.OPENAI_PRICE_OUTPUT_PER_1M);
  if (!env.OPENAI_PRICE_INPUT_PER_1M || !env.OPENAI_PRICE_OUTPUT_PER_1M || !(input >= 0) || !(output >= 0)) {
    throw new Error(
      "Set OPENAI_PRICE_INPUT_PER_1M and OPENAI_PRICE_OUTPUT_PER_1M (USD per million tokens for OPENAI_MODEL) so the run records its cost."
    );
  }
  return { input, output };
};

/** Cached input tokens are billed at the full input price, so cost is an upper bound. */
export const costUsd = ({ input_tokens, output_tokens }, prices) =>
  Math.round(((input_tokens * prices.input + output_tokens * prices.output) / 1e6) * 10000) / 10000;

const isTemperatureUnsupported = (err) =>
  err?.status === 400 && /temperature/i.test(`${err?.param ?? ""} ${err?.message ?? ""}`);

/**
 * Score one batch. Retries API errors and invalid responses; tokens from every
 * attempt count toward the run's cost.
 *
 * @param {{
 *   client: import("openai").default,
 *   model: string,
 *   prompt: string,
 *   batch: ReturnType<typeof makeBatches>[number],
 *   settings: { temperature: boolean },
 *   usage: { input_tokens: number, output_tokens: number },
 *   attempts?: number,
 *   log?: (msg: string) => void,
 * }} args
 */
export const scoreBatch = async ({ client, model, prompt, batch, settings, usage, attempts = 3, log = () => {} }) => {
  const schema = batchResponseSchema(batch.tasks.map((t) => t.task_id));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const withTemperature = settings.temperature;
    try {
      const response = await client.responses.create({
        model,
        instructions: prompt,
        input: JSON.stringify(batch),
        text: { format: zodTextFormat(wireResponseSchema, "task_exposure_scores") },
        ...(withTemperature ? { temperature: 0 } : {}),
        max_output_tokens: 16000,
        store: false,
      });
      usage.input_tokens += response.usage?.input_tokens ?? 0;
      usage.output_tokens += response.usage?.output_tokens ?? 0;
      if (response.status !== "completed") {
        throw new Error(`response ${response.status}: ${response.incomplete_details?.reason ?? "unknown"}`);
      }
      const parsed = schema.safeParse(JSON.parse(response.output_text));
      if (!parsed.success) {
        throw new Error(`invalid scores: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      }
      return parsed.data.scores;
    } catch (err) {
      if (withTemperature && isTemperatureUnsupported(err)) {
        // Reasoning models reject temperature; they are run at their default instead.
        if (settings.temperature) log(`${model} does not accept temperature; continuing without it`);
        settings.temperature = false;
        attempt--;
        continue;
      }
      lastError = err;
      log(`batch ${batch.onetsoc_code} attempt ${attempt} failed: ${err.message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
};
