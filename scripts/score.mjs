// Exposure scoring entry point: npm run score -- --dataset <id>
// Stub until milestone 3 adds task import, batching, and run logging.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { dataset: { type: "string" } },
  allowPositionals: false,
});

console.log(
  `score: not implemented yet (milestone 3). dataset=${values.dataset ?? "none"}`
);
