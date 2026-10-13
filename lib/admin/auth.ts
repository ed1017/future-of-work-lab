import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { SESSION_COOKIE, SESSION_SECONDS, createSession, isAdminEmail, readSession } from "@/lib/admin/session.mjs";
import { supabaseProjectUrl } from "@/lib/scoring/supabase-url.mjs";

// Server-only admin sign-in. Supabase Auth emails a one-time code to ADMIN_EMAIL; once the
// code verifies, the app sets its own signed cookie. Visitors never need an account.

const env = (name: string) => process.env[name]?.trim() ?? "";

/** The signed-in admin's email, or null for every anonymous visitor. */
export async function getAdmin(): Promise<string | null> {
  const store = await cookies();
  return readSession(store.get(SESSION_COOKIE)?.value, env("ADMIN_SESSION_SECRET"), env("ADMIN_EMAIL"));
}

/** Call first in every mutation. Throws for anyone who is not the admin. */
export async function requireAdmin(): Promise<string> {
  const admin = await getAdmin();
  if (!admin) throw new Error("Admin sign-in required.");
  return admin;
}

/** What is missing from the server configuration, by variable name only (never values). */
export function missingAdminConfig(): string[] {
  return ["ADMIN_EMAIL", "ADMIN_SESSION_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((name) => !env(name)).concat(
    env("ADMIN_SESSION_SECRET") && env("ADMIN_SESSION_SECRET").length < 32 ? ["ADMIN_SESSION_SECRET (needs 32+ characters)"] : [],
  );
}

function authClient() {
  return createClient(supabaseProjectUrl(env("SUPABASE_URL")), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Emails a code, but only when the address is the admin's. Returns true when one was sent. */
export async function sendAdminCode(email: string): Promise<boolean> {
  if (missingAdminConfig().length || !isAdminEmail(email, env("ADMIN_EMAIL"))) return false;
  const { error } = await authClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  return !error;
}

/** Verifies the emailed code and, on success, starts the admin session cookie. */
export async function verifyAdminCode(email: string, code: string): Promise<boolean> {
  if (missingAdminConfig().length || !isAdminEmail(email, env("ADMIN_EMAIL"))) return false;
  const { data, error } = await authClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error || !isAdminEmail(data.user?.email, env("ADMIN_EMAIL"))) return false;
  const value = createSession(email, env("ADMIN_SESSION_SECRET"));
  if (!value) return false;
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return true;
}

export async function endAdminSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
