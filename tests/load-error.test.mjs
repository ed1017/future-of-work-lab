import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// describeLoadError is TypeScript, so check its redaction rules on the source text.
const source = await readFile(new URL("../lib/data/fow.ts", import.meta.url), "utf8");

test("Load errors redact configured secrets and key-shaped strings", () => {
  for (const pattern of ["sb_(?:secret|publishable)_", "eyJ", "sk-", "SUPABASE_SERVICE_ROLE_KEY", "https?:"]) {
    assert.ok(source.includes(pattern), `describeLoadError no longer handles ${pattern}`);
  }
});

test("Env values are trimmed before use", () => {
  assert.match(source, /SUPABASE_URL\?\.trim\(\)/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
});
