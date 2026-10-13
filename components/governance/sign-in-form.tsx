"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/app/admin/actions";

const input =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const button = "h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {
    step: "email",
    email: "",
    message: null,
  });
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        Admin email
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className={`mt-1 ${input}`} />
      </label>
      {state.step === "code" ? (
        <label className="block text-sm">
          6-digit code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required className={`mt-1 ${input}`} />
        </label>
      ) : null}
      {state.message ? <p className="text-sm text-muted-foreground" role="status">{state.message}</p> : null}
      <button type="submit" disabled={pending} className={button}>
        {state.step === "code" ? "Sign in" : "Email me a code"}
      </button>
    </form>
  );
}
