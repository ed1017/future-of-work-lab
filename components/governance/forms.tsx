"use client";

import { useActionState } from "react";
import {
  deleteUseCaseAction,
  saveAssessmentAction,
  saveUseCaseAction,
  type EditState,
} from "@/app/governance/actions";
import type { AssessmentRow, ToolOption, UseCaseDetail } from "@/lib/data/fow";
import { DECISION_IMPACT, FRAMEWORKS, REVIEW_STATES, TIERS, USE_CASE_STATUS } from "@/lib/governance/schema.mjs";

const idle: EditState = { ok: false, message: null, errors: {} };
const field =
  "mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const area = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const primary = "h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60";
const label = (s: string) => s.replace(/_/g, " ");

function Field({ name, title, state, children }: { name: string; title: string; state: EditState; children: React.ReactNode }) {
  const error = state.errors[name];
  return (
    <label className="block text-sm">
      {title}
      {children}
      {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

function Status({ state }: { state: EditState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-primary" : "text-destructive"}`}>
      {state.message}
    </p>
  );
}

export function UseCaseForm({ useCase, tools }: { useCase: UseCaseDetail | null; tools: ToolOption[] }) {
  const [state, action, pending] = useActionState(saveUseCaseAction, idle);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {useCase ? <input type="hidden" name="use_case_id" value={useCase.use_case_id} /> : null}
      <Field name="name" title="Name" state={state}>
        <input name="name" required maxLength={120} defaultValue={useCase?.name} className={field} />
      </Field>
      <Field name="hr_process" title="HR process" state={state}>
        <input name="hr_process" required maxLength={80} defaultValue={useCase?.hr_process} className={field} />
      </Field>
      <Field name="owner" title="Owning team" state={state}>
        <input name="owner" required maxLength={80} defaultValue={useCase?.owner} className={field} />
      </Field>
      <Field name="tool_id" title="Tool" state={state}>
        <select name="tool_id" defaultValue={useCase?.tool_id ?? ""} className={field}>
          <option value="">None</option>
          {tools.map((t) => (
            <option key={t.tool_id} value={t.tool_id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field name="decision_impact" title="Decision impact" state={state}>
        <select name="decision_impact" defaultValue={useCase?.decision_impact ?? "informs"} className={field}>
          {DECISION_IMPACT.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field name="status" title="Status" state={state}>
        <select name="status" defaultValue={useCase?.status ?? "proposed"} className={field}>
          {USE_CASE_STATUS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field name="human_in_loop" title="Human in the loop" state={state}>
        <select name="human_in_loop" defaultValue={useCase ? (useCase.human_in_loop ? "yes" : "no") : "yes"} className={field}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field name="description" title="Description" state={state}>
          <textarea name="description" rows={3} maxLength={600} defaultValue={useCase?.description ?? ""} className={area} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>
          {useCase ? "Save changes" : "Add use case"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function AssessmentForm({ useCaseId, latest }: { useCaseId: string; latest: AssessmentRow | null }) {
  const [state, action, pending] = useActionState(saveAssessmentAction, idle);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="use_case_id" value={useCaseId} />
      <Field name="framework" title="Framework" state={state}>
        <select name="framework" defaultValue={latest?.framework ?? FRAMEWORKS[0]} className={field}>
          {FRAMEWORKS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field name="tier" title="Risk tier" state={state}>
        <select name="tier" defaultValue={latest?.tier ?? "medium"} className={field}>
          {TIERS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field name="review_state" title="Review state" state={state}>
        <select name="review_state" defaultValue={latest?.review_state ?? "draft"} className={field}>
          {REVIEW_STATES.map((v) => (
            <option key={v} value={v}>
              {label(v)}
            </option>
          ))}
        </select>
      </Field>
      <Field name="assessed_on" title="Assessed on" state={state}>
        <input name="assessed_on" type="date" required defaultValue={today} className={field} />
      </Field>
      <Field name="bias_audit_date" title="Last bias audit (NYC LL 144)" state={state}>
        <input name="bias_audit_date" type="date" defaultValue={latest?.bias_audit_date ?? ""} className={field} />
      </Field>
      <Field name="next_review_date" title="Next review due" state={state}>
        <input name="next_review_date" type="date" defaultValue={latest?.next_review_date ?? ""} className={field} />
      </Field>
      <div className="sm:col-span-2">
        <Field name="rationale" title="Rationale" state={state}>
          <textarea name="rationale" required rows={3} maxLength={600} defaultValue={latest?.rationale ?? ""} className={area} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>
          Record assessment
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function DeleteUseCaseForm({ useCaseId }: { useCaseId: string }) {
  const [state, action, pending] = useActionState(deleteUseCaseAction, idle);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="use_case_id" value={useCaseId} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm("Delete this use case and its risk assessments? This can't be undone.")) e.preventDefault();
        }}
        className="h-10 rounded-lg border border-destructive px-4 text-sm font-medium text-destructive disabled:opacity-60"
      >
        Delete use case
      </button>
      <Status state={state} />
    </form>
  );
}
