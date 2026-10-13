"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { deleteUseCase, insertAssessment, upsertUseCase } from "@/lib/data/fow";
import { assessmentSchema, fieldErrors, formValues, useCaseSchema } from "@/lib/governance/schema.mjs";

export type EditState = { ok: boolean; message: string | null; errors: Record<string, string> };

const idle: EditState = { ok: false, message: null, errors: {} };

async function admin(): Promise<EditState | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return { ok: false, message: "Admin sign-in required.", errors: {} };
  }
}

// Database failures return a fixed message; the raw error is never sent to the page.
const failed: EditState = { ok: false, message: "The change couldn't be saved. Check the values and try again.", errors: {} };

export async function saveUseCaseAction(_previous: EditState, formData: FormData): Promise<EditState> {
  const denied = await admin();
  if (denied) return denied;
  const values = formValues(formData);
  const parsed = useCaseSchema.safeParse(values);
  if (!parsed.success) return { ...idle, message: "Fix the highlighted fields.", errors: fieldErrors(parsed.error) };
  const id = typeof values.use_case_id === "string" && values.use_case_id ? values.use_case_id : null;
  try {
    await upsertUseCase(id, parsed.data);
  } catch {
    return failed;
  }
  revalidatePath("/governance");
  revalidatePath("/");
  return { ...idle, ok: true, message: id ? "Use case updated." : "Use case added." };
}

export async function saveAssessmentAction(_previous: EditState, formData: FormData): Promise<EditState> {
  const denied = await admin();
  if (denied) return denied;
  const parsed = assessmentSchema.safeParse(formValues(formData));
  if (!parsed.success) return { ...idle, message: "Fix the highlighted fields.", errors: fieldErrors(parsed.error) };
  try {
    await insertAssessment(parsed.data);
  } catch {
    return failed;
  }
  revalidatePath("/governance");
  revalidatePath("/");
  return { ...idle, ok: true, message: "Risk assessment recorded." };
}

export async function deleteUseCaseAction(_previous: EditState, formData: FormData): Promise<EditState> {
  const denied = await admin();
  if (denied) return denied;
  const id = String(formData.get("use_case_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return failed;
  try {
    await deleteUseCase(id);
  } catch {
    return failed;
  }
  revalidatePath("/governance");
  revalidatePath("/");
  return { ...idle, ok: true, message: "Use case deleted." };
}
