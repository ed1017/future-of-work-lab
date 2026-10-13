import Link from "next/link";
import { AssessmentForm, DeleteUseCaseForm, UseCaseForm } from "@/components/governance/forms";
import { signOutAction } from "@/app/admin/actions";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { LoadError } from "@/components/load-error";
import { SiteHeader } from "@/components/site-header";
import { getAdmin } from "@/lib/admin/auth";
import { describeLoadError, getEditContext, getRegister } from "@/lib/data/fow";
import { daysOverdue, filterRegister, registerSummary, sortRegister } from "@/lib/governance/register.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TIER_STYLE: Record<string, string> = {
  high: "bg-[#FBE3DA] text-[#8A2F14]",
  medium: "bg-[#FBEFC4] text-[#6B4E00]",
  low: "bg-[#DDEFEA] text-[#0F5B57]",
};
const REVIEW_STYLE: Record<string, string> = {
  Overdue: "bg-[#A3341A] text-white",
  "Bias audit due": "bg-[#FBE3DA] text-[#8A2F14]",
  "In review": "bg-[#E4E8F8] text-[#27358C]",
  "Not reviewed": "bg-muted text-muted-foreground",
  Approved: "bg-[#DDEFEA] text-[#0F5B57]",
};
const TIERS = ["high", "medium", "low", "unassessed"];
const STATUSES = ["proposed", "pilot", "production", "retired"];
const REVIEWS = ["flagged", "Overdue", "Bias audit due", "In review", "Not reviewed", "Approved"];

const select =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card className={`p-5 ${alert && value > 0 ? "border-[#A3341A]" : ""}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-3 font-heading text-4xl font-semibold ${alert && value > 0 ? "text-[#A3341A]" : ""}`}>{value}</p>
    </Card>
  );
}

export default async function GovernancePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const admin = await getAdmin();
  let register;
  let edit = null;
  try {
    register = await getRegister();
    if (admin) edit = await getEditContext();
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }

  const tier = first(params.tier) ?? null;
  const status = first(params.status) ?? null;
  const review = first(params.review) ?? null;
  const summary = registerSummary(register);
  const rows = sortRegister(filterRegister(register, { tier, status, review }));

  const editing = first(params.edit) ?? null;
  const current = edit && editing && editing !== "new" ? (edit.useCases.find((u) => u.use_case_id === editing) ?? null) : null;
  const history = current && edit ? edit.assessments.filter((a) => a.use_case_id === current.use_case_id) : [];
  const showEditor = Boolean(admin && edit && (editing === "new" || current));

  return (
    <div className="min-h-screen">
      <SiteHeader active="/governance" datasetName="Built-in company" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Is HR&apos;s use of AI under control?</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              The register of HR AI use cases with risk tier and review status. Reviews past their due date are flagged.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {admin ? (
              <>
                <span className="text-muted-foreground">Signed in as admin</span>
                <Link href="/governance?edit=new#editor" className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
                  Add use case
                </Link>
                <form action={signOutAction}>
                  <button type="submit" className="rounded-lg border border-input px-4 py-2">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/admin/sign-in" className="rounded-lg border border-input px-4 py-2">
                Admin sign-in
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Use cases" value={summary.total} />
          <Stat label="High risk" value={summary.highRisk} />
          <Stat label="Overdue reviews" value={summary.overdue} alert />
          <Stat label="Bias audits due" value={summary.biasAuditDue} alert />
          <Stat label="Not reviewed" value={summary.notReviewed} />
        </div>

        <Card className="mt-4">
          <CardHeading title="Use-case register" subtitle={`${rows.length} of ${register.length} shown. Overdue and bias-audit-due items come first.`} />
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Risk tier
              <select name="tier" defaultValue={tier ?? ""} className={select}>
                <option value="">All</option>
                {TIERS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Status
              <select name="status" defaultValue={status ?? ""} className={select}>
                <option value="">All</option>
                {STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Review
              <select name="review" defaultValue={review ?? ""} className={select}>
                <option value="">All</option>
                {REVIEWS.map((v) => (
                  <option key={v} value={v}>
                    {v === "flagged" ? "Needs attention (overdue or audit due)" : v}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              Apply
            </button>
            <Link href="/governance" className="h-10 content-center text-sm text-primary underline underline-offset-4">
              Reset
            </Link>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Use case</th>
                  <th className="py-2 pr-3 font-medium">Tool</th>
                  <th className="py-2 pr-3 font-medium">Decision impact</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Risk</th>
                  <th className="py-2 pr-3 font-medium">Review</th>
                  <th className="py-2 pr-3 font-medium">Next review</th>
                  {admin ? <th className="py-2 font-medium">Edit</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = daysOverdue(r.next_review_date);
                  return (
                    <tr key={r.use_case_id} className={`border-b border-border/70 align-top last:border-0 ${r.is_overdue ? "bg-[#FBE3DA]/40" : ""}`}>
                      <td className="py-3 pr-3">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.hr_process} · {r.owner}
                          {r.human_in_loop === false ? " · no human in the loop" : ""}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        {r.tool_name ?? "None"}
                        {r.tool_approved === false ? <span className="ml-1 text-xs text-[#8A2F14]">(unapproved)</span> : null}
                      </td>
                      <td className="py-3 pr-3 capitalize">{r.decision_impact}</td>
                      <td className="py-3 pr-3 capitalize">{r.status}</td>
                      <td className="py-3 pr-3">
                        {r.risk_tier ? (
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${TIER_STYLE[r.risk_tier]}`}>{r.risk_tier}</span>
                        ) : (
                          <span className="text-muted-foreground">Unassessed</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${REVIEW_STYLE[r.review_status] ?? "bg-muted"}`}>{r.review_status}</span>
                      </td>
                      <td className="py-3 pr-3">
                        {r.next_review_date ?? "n/a"}
                        {r.is_overdue && late !== null ? (
                          <span className="block text-xs font-semibold text-[#A3341A]">
                            {late} {late === 1 ? "day" : "days"} overdue
                          </span>
                        ) : null}
                        {r.bias_audit_due ? <span className="block text-xs text-[#8A2F14]">Bias audit due</span> : null}
                      </td>
                      {admin ? (
                        <td className="py-3">
                          <Link className="text-primary underline underline-offset-4" href={`/governance?edit=${r.use_case_id}#editor`}>
                            Edit
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Nothing matches these filters.</p> : null}
          <SourceNote view="fow.v_register" filter="one row per use case; is_overdue = earliest next_review_date has passed" />
        </Card>

        {showEditor && edit ? (
          <div id="editor" className="mt-4 space-y-4">
            <Card>
              <CardHeading title={current ? `Edit: ${current.name}` : "Add a use case"} subtitle="Changes are saved to the register immediately." />
              <UseCaseForm key={current?.use_case_id ?? "new"} useCase={current} tools={edit.tools} />
            </Card>
            {current ? (
              <>
                <Card>
                  <CardHeading
                    title="Risk assessments"
                    subtitle="Recording an assessment on the same date and framework replaces it; a newer date becomes the current one."
                  />
                  {history.length ? (
                    <ul className="mb-5 divide-y divide-border/70 text-sm">
                      {history.map((a) => (
                        <li key={a.assessment_id} className="py-2">
                          <span className="font-medium">{a.framework}</span> · {a.tier} · {a.review_state.replace(/_/g, " ")} · assessed {a.assessed_on}
                          {a.next_review_date ? ` · next review ${a.next_review_date}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-5 text-sm text-muted-foreground">No assessments yet.</p>
                  )}
                  <AssessmentForm key={current.use_case_id} useCaseId={current.use_case_id} latest={history[0] ?? null} />
                </Card>
                <Card>
                  <CardHeading title="Delete" subtitle="Removes the use case and its assessments. Set the status to retired instead to keep the history." />
                  <DeleteUseCaseForm useCaseId={current.use_case_id} />
                </Card>
              </>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
