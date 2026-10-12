// Seed the builtin dataset and synthetic fow data: npm run seed [-- --seed <n>]
// Calls fow.seed_builtin(), which is deterministic for a given seed. Needs
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local or the shell),
// and the fow schema listed under the project's Data API exposed schemas.
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

const DEFAULT_SEED = 20261012;

const { values } = parseArgs({
  options: { seed: { type: "string" } },
  allowPositionals: false,
});

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on variables already in the environment.
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("seed: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
if (!Number.isInteger(seed)) {
  console.error(`seed: --seed must be an integer, got ${values.seed}`);
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supabase
  .schema("fow")
  .rpc("seed_builtin", { p_seed: seed });

if (error) {
  console.error(`seed: ${error.message}`);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
