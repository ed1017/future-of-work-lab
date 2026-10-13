import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

const read = (path) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

test("Navigation lists the seven routes from the spec", async () => {
  const routes = await read("lib/routes.ts");

  for (const href of [
    "/",
    "/exposure",
    "/adoption",
    "/governance",
    "/actions",
    "/methodology",
    "/upload",
  ]) {
    assert.match(routes, new RegExp('href: "' + href + '"'));
  }
});

test("Server secrets are never exposed with a NEXT_PUBLIC_ prefix", async () => {
  const sources = [".env.example"];
  for (const dir of ["app", "lib", "components", "scripts"]) {
    for (const entry of await readdir(new URL("../" + dir, import.meta.url), {
      recursive: true,
    })) {
      if (/\.(ts|tsx|mjs|js)$/.test(entry)) sources.push(dir + "/" + entry);
    }
  }

  for (const path of sources) {
    const text = await read(path);
    assert.doesNotMatch(
      text,
      /NEXT_PUBLIC_(SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY)/,
      path
    );
  }
});

test("Score script needs a dataset and Supabase credentials before it does anything", async () => {
  const script = new URL("../scripts/score.mjs", import.meta.url).pathname;
  const env = { PATH: process.env.PATH };
  // Run outside the repo so a developer's .env.local is not loaded.
  const opts = { cwd: tmpdir(), env };
  await assert.rejects(run(process.execPath, [script], opts), (err) => {
    assert.match(err.stderr, /Usage: npm run score -- --dataset <id>/);
    return true;
  });
  await assert.rejects(run(process.execPath, [script, "--dataset", "builtin"], opts), (err) => {
    assert.match(err.stderr, /Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
    return true;
  });
});
