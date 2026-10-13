import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSession, isAdminEmail, readSession } from "../lib/admin/session.mjs";

const secret = "x".repeat(40);
const admin = "Ed@Example.com";
const now = Date.UTC(2026, 9, 13, 12);

test("Only the configured ADMIN_EMAIL is the admin, ignoring case and spaces", () => {
  assert.equal(isAdminEmail(" ed@example.com ", admin), true);
  assert.equal(isAdminEmail("other@example.com", admin), false);
  assert.equal(isAdminEmail("ed@example.com", ""), false, "no ADMIN_EMAIL means no admin");
  assert.equal(isAdminEmail("", ""), false);
});

test("A valid session reads back as the admin", () => {
  const cookie = createSession(admin, secret, now);
  assert.equal(readSession(cookie, secret, admin, now + 60_000), "ed@example.com");
});

test("Anonymous, forged, tampered, expired, and re-assigned sessions are not admin", () => {
  const cookie = createSession(admin, secret, now);
  assert.equal(readSession(undefined, secret, admin, now), null);
  assert.equal(readSession("", secret, admin, now), null);
  assert.equal(readSession("garbage", secret, admin, now), null);
  assert.equal(readSession(cookie, "y".repeat(40), admin, now), null, "wrong secret");
  const [payload, mac] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "ed@example.com", x: 9_999_999_999 })).toString("base64url");
  assert.equal(readSession(`${forged}.${mac}`, secret, admin, now), null, "payload swapped");
  assert.equal(readSession(`${payload}.${mac}x`, secret, admin, now), null, "mac altered");
  assert.equal(readSession(cookie, secret, admin, now + 9 * 3600_000), null, "expired after 8 hours");
  assert.equal(readSession(cookie, secret, "someone-else@example.com", now), null, "ADMIN_EMAIL changed");
});

test("Without a strong secret no session is created or accepted (fail closed)", () => {
  assert.equal(createSession(admin, "", now), null);
  assert.equal(createSession(admin, "short", now), null);
  assert.equal(readSession(createSession(admin, secret, now), "", admin, now), null);
});

test("Every register write action checks the admin session before touching the database", async () => {
  const source = await readFile(new URL("../app/governance/actions.ts", import.meta.url), "utf8");
  const actions = [...source.matchAll(/export async function (\w+Action)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
  assert.deepEqual(actions.map((m) => m[1]).sort(), ["deleteUseCaseAction", "saveAssessmentAction", "saveUseCaseAction"]);
  for (const [, name, body] of actions) {
    const guard = body.indexOf("await admin()");
    const write = body.search(/\b(upsertUseCase|insertAssessment|deleteUseCase)\(/);
    assert.ok(guard >= 0 && write > guard, `${name} must call the admin check before writing`);
  }
});

test("Write helpers are only imported by the admin-guarded actions", async () => {
  const { readdir } = await import("node:fs/promises");
  const hits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !dir.pathname.endsWith("/tests/")) {
        if (/\b(upsertUseCase|insertAssessment|deleteUseCase)\b/.test(await readFile(path, "utf8"))) hits.push(path.pathname.split("/future-of-work-lab/")[1]);
      }
    }
  };
  for (const d of ["app/", "components/", "lib/"]) await walk(new URL(`../${d}`, import.meta.url));
  assert.deepEqual(hits.sort(), ["app/governance/actions.ts", "lib/data/fow.ts"]);
});

test("Validation review actions check the admin session first, and only they use the review write helpers", async () => {
  const source = await readFile(new URL("../app/admin/review/actions.ts", import.meta.url), "utf8");
  const actions = [...source.matchAll(/export async function (\w+Action)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
  assert.deepEqual(actions.map((m) => m[1]).sort(), ["drawSampleAction", "saveReviewAction"]);
  for (const [, name, body] of actions) {
    const guard = body.indexOf("await requireAdmin()");
    const write = body.search(/\b(drawValidationSample|saveReview)\(/);
    assert.ok(guard >= 0 && write > guard, `${name} must call requireAdmin before writing`);
  }
  const { readdir } = await import("node:fs/promises");
  const hits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && /\b(drawValidationSample|saveReview)\b/.test(await readFile(path, "utf8"))) hits.push(path.pathname.split("/future-of-work-lab/")[1]);
    }
  };
  for (const d of ["app/", "components/", "lib/"]) await walk(new URL(`../${d}`, import.meta.url));
  assert.deepEqual(hits.sort(), ["app/admin/review/actions.ts", "lib/data/fow.ts"]);
});

test("The public methodology page never selects reviewer identity or notes", async () => {
  const page = await readFile(new URL("../app/methodology/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /getReviewQueue|\.reviewer\b|\.note\b/);
});
