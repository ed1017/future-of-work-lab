import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

// Live check against the Supabase project with the public anon key. Skipped
// unless SUPABASE_URL and SUPABASE_ANON_KEY are set (the anon key is not a secret).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the shell environment.
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const skip = !url || !anonKey ? "SUPABASE_URL and SUPABASE_ANON_KEY not set" : false;

const anonCannotRead = async (schema, table) => {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error, status } = await anon.schema(schema).from(table).select("*").limit(1);
  // status 0 means the request never reached Supabase; that proves nothing.
  assert.notEqual(status, 0, `could not reach Supabase: ${error?.message}`);
  assert.ok(error || data.length === 0, `anon read rows from ${schema}.${table}`);
};

for (const table of ["employees", "employee_snapshots", "employee_demographics"]) {
  test(`An anonymous client cannot select from public.${table}`, { skip }, () =>
    anonCannotRead("public", table)
  );
}

for (const table of [
  "ai_usage_weekly",
  "ai_pulse_responses",
  "v_job_exposure",
  "v_function_exposure",
  "v_exposure_adoption",
  "v_register",
]) {
  test(`An anonymous client cannot select from fow.${table}`, { skip }, () =>
    anonCannotRead("fow", table)
  );
}
