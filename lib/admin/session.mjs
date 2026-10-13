import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring admin session cookie. Pure functions so tests can cover them; the
// Next.js glue (cookies, redirects) lives in lib/admin/auth.ts.

export const SESSION_COOKIE = "fow_admin";
export const SESSION_SECONDS = 8 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

/** True only when ADMIN_EMAIL is configured and the address matches it (case-insensitive). */
export function isAdminEmail(email, adminEmail) {
  const configured = normalizeEmail(adminEmail);
  return configured.length > 0 && normalizeEmail(email) === configured;
}

const b64 = (value) => Buffer.from(value).toString("base64url");

const sign = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

/** Returns a cookie value, or null when the secret is missing or too short (fail closed). */
export function createSession(email, secret, now = Date.now()) {
  const key = String(secret ?? "").trim();
  if (key.length < MIN_SECRET_LENGTH) return null;
  const payload = b64(JSON.stringify({ e: normalizeEmail(email), x: Math.floor(now / 1000) + SESSION_SECONDS }));
  return `${payload}.${sign(payload, key)}`;
}

/** The session's email when the cookie is genuine, unexpired, and still the admin's; else null. */
export function readSession(value, secret, adminEmail, now = Date.now()) {
  const key = String(secret ?? "").trim();
  if (key.length < MIN_SECRET_LENGTH || typeof value !== "string") return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof x !== "number" || x * 1000 < now) return null;
    return isAdminEmail(e, adminEmail) ? normalizeEmail(e) : null;
  } catch {
    return null;
  }
}
