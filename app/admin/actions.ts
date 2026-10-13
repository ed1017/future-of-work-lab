"use server";

import { redirect } from "next/navigation";
import { endAdminSession, sendAdminCode, verifyAdminCode } from "@/lib/admin/auth";

export type SignInState = { step: "email" | "code"; email: string; message: string | null };

// Fixed messages only: nothing from a failed call is echoed back, and the reply to a
// code request is the same whether or not the address is the admin's.
export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().slice(0, 254);
  const code = String(formData.get("code") ?? "").trim().slice(0, 12);
  if (!code) {
    await sendAdminCode(email);
    return { step: "code", email, message: "If that is the admin address, a 6-digit code is on its way." };
  }
  if (await verifyAdminCode(email, code)) redirect("/governance");
  return { step: "code", email, message: "That code didn't work. Check it and try again, or request a new one." };
}

export async function signOutAction() {
  await endAdminSession();
  redirect("/governance");
}
