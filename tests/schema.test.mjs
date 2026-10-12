import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const sql = (
  await Promise.all(files.map((f) => readFile(new URL(f, dir), "utf8")))
)
  .join("\n")
  .replace(/--.*$/gm, "")
  .toLowerCase();

test("Migrations are plain SQL files named <timestamp>_<name>.sql", () => {
  assert.ok(files.length > 0);
  for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/);
});

test("Every fow table has row level security enabled", () => {
  const tables = [...sql.matchAll(/create table (fow\.\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 13, "expected the spec's fow tables");
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security`),
      table
    );
  }
});

test("Migrations never create, change, or write public objects", () => {
  assert.doesNotMatch(
    sql,
    /\b(create|alter|drop|truncate|comment on|grant|revoke)\b[^;]*?\b(table|view|function|schema|index|policy|on)\s+(if (not )?exists\s+)?public\./
  );
  assert.doesNotMatch(sql, /\b(insert into|update|delete from)\s+public\./);
  assert.doesNotMatch(sql, /references\s+public\./);
});

test("anon and authenticated are never granted anything in fow", () => {
  for (const m of sql.matchAll(/\bgrant\b[^;]*;/g)) {
    assert.doesNotMatch(m[0], /\b(anon|authenticated|public)\b\s*;/, m[0]);
    assert.doesNotMatch(m[0], /\bto\b[^;]*\b(anon|authenticated)\b/, m[0]);
  }
});

test("The four UI views exist, run as the caller, and suppress small groups", () => {
  for (const view of [
    "v_job_exposure",
    "v_function_exposure",
    "v_exposure_adoption",
    "v_register",
  ]) {
    assert.match(
      sql,
      new RegExp(`create view fow\\.${view}\\s+with \\(security_invoker = true\\)`),
      view
    );
  }
  for (const view of ["v_job_exposure", "v_function_exposure", "v_exposure_adoption"]) {
    const body = sql.slice(sql.indexOf(`create view fow.${view}`)).split(/;\s*\n/)[0];
    assert.match(body, /fow\.min_group_size\(\)/, view);
  }
  assert.match(sql, /create function fow\.min_group_size\(\)[\s\S]*?select 10/);
});

test("The seed has a fixed default seed", () => {
  assert.match(sql, /create function fow\.seed_builtin\(p_seed integer default 20261012\)/);
});
