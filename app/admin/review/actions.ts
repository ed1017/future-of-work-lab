"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { drawValidationSample, saveReview } from "@/lib/data/fow";
import { LABELS } from "@/lib/validation/metrics.mjs";

// Admin-only. The admin check comes first; failures redirect with a fixed code and never
// carry the database error to the page.
export async function drawSampleAction() {
  await requireAdmin();
  let status = "drawn";
  try {
    status = (await drawValidationSample()) ? "drawn" : "exists";
  } catch {
    status = "failed";
  }
  revalidatePath("/admin/review");
  redirect(`/admin/review?notice=${status}`);
}

export async function saveReviewAction(formData: FormData) {
  const reviewer = await requireAdmin();
  const taskId = Number(formData.get("task_id"));
  const label = String(formData.get("label") ?? "");
  const next = String(formData.get("next") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!Number.isInteger(taskId) || taskId <= 0 || !(LABELS as readonly string[]).includes(label)) redirect(`/admin/review?task=${taskId}&notice=invalid`);
  try {
    await saveReview({ task_id: taskId, reviewer, label: label as (typeof LABELS)[number], note });
  } catch {
    redirect(`/admin/review?task=${taskId}&notice=failed`);
  }
  revalidatePath("/admin/review");
  revalidatePath("/methodology");
  redirect(/^\d+$/.test(next) ? `/admin/review?task=${next}` : "/admin/review?notice=done");
}
