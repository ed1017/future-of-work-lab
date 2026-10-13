// The model call for one function's recommendation.
import { zodTextFormat } from "openai/helpers/zod";
import { plannerInput, recommendationSchema, wireRecommendationSchema } from "./plan.mjs";

const isTemperatureUnsupported = (err) =>
  err?.status === 400 && /temperature/i.test(`${err?.param ?? ""} ${err?.message ?? ""}`);

/**
 * Ask the model for one recommendation and validate it. An invalid answer is retried
 * with the problems listed, so the model can fix them; tokens from every attempt count.
 *
 * @param {{
 *   client: import("openai").default,
 *   model: string,
 *   prompt: string,
 *   offered: ReturnType<typeof import("./facts.mjs").buildFunctionFacts>,
 *   settings: { temperature: boolean },
 *   usage: { input_tokens: number, output_tokens: number },
 *   attempts?: number,
 *   log?: (msg: string) => void,
 * }} args
 */
export const planFunction = async ({ client, model, prompt, offered, settings, usage, attempts = 3, log = () => {} }) => {
  const schema = recommendationSchema(offered);
  const input = plannerInput(offered);
  /** @type {string[]} */
  let problems = [];
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const withTemperature = settings.temperature;
    try {
      const response = await client.responses.create({
        model,
        instructions: prompt,
        input: JSON.stringify(problems.length ? { ...input, fix_these_problems_from_your_last_answer: problems } : input),
        text: { format: zodTextFormat(wireRecommendationSchema, "action_recommendation") },
        ...(withTemperature ? { temperature: 0 } : {}),
        max_output_tokens: 8000,
        store: false,
      });
      usage.input_tokens += response.usage?.input_tokens ?? 0;
      usage.output_tokens += response.usage?.output_tokens ?? 0;
      if (response.status !== "completed") {
        throw new Error(`response ${response.status}: ${response.incomplete_details?.reason ?? "unknown"}`);
      }
      const parsed = schema.safeParse(JSON.parse(response.output_text));
      if (!parsed.success) {
        problems = parsed.error.issues.map((i) => i.message);
        throw new Error(`invalid recommendation: ${problems.join("; ")}`);
      }
      return parsed.data;
    } catch (err) {
      if (withTemperature && isTemperatureUnsupported(err)) {
        // Reasoning models reject temperature; they are run at their default instead.
        log(`${model} does not accept temperature; continuing without it`);
        settings.temperature = false;
        attempt--;
        continue;
      }
      lastError = err;
      log(`${offered.function} attempt ${attempt} failed: ${err.message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
};
