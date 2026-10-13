import Link from "next/link";
import { ArrowUpRight, CircleCheck, CircleX, GraduationCap, Route, TriangleAlert } from "lucide-react";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { int } from "@/components/format";
import { LoadError } from "@/components/load-error";
import { MoveBadge } from "@/components/move-badge";
import { OverviewFilters } from "@/components/overview-filters";
import { SiteHeader } from "@/components/site-header";
import { describeLoadError, getActionPlanData } from "@/lib/data/fow";
import { planningScope, rowsByView } from "@/lib/actions/facts.mjs";
import { MIN_METRIC_EVIDENCE } from "@/lib/actions/evidence.mjs";
import { buildPlan } from "@/lib/actions/screen.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Item = ReturnType<typeof buildPlan>["plans"][number]["metrics"][number];

const MOVE_HELP: Record<string, string> = {
  redesign: "rebuild roles around AI",
  redeploy: "move people to less exposed work",
  reskill: "build AI skills and use",
  hold: "monitor",
};

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-heading text-4xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{note}</p>
    </Card>
  );
}

function StatusIcon({ status }: { status: Item["status"] }) {
  if (status === "match") return <CircleCheck aria-label="Matches the view today" className="size-4 shrink-0 text-[#0F5B57]" />;
  if (status === "changed") return <TriangleAlert aria-label="Changed since the plan was generated" className="size-4 shrink-0 text-[#6B4E00]" />;
  return <CircleX aria-label="No longer in the view" className="size-4 shrink-0 text-destructive" />;
}

function EvidenceItem({ item }: { item: Item }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">{item.label}</span>
      <span className="shrink-0 font-semibold tabular-nums">
        {item.value}
        {item.current ? <span className="ml-1 font-normal text-muted-foreground">(now {item.current})</span> : null}
      </span>
    </>
  );
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm" title={`Source: ${item.source}`}>
      <StatusIcon status={item.status} />
      {item.href ? (
        <Link href={item.href} className="group flex min-w-0 flex-1 items-start gap-3 hover:text-primary">
          {body}
          <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-3">
          {body}
          <span className="w-3.5 shrink-0" />
        </span>
      )}
    </li>
  );
}

export default async function ActionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let loaded;
  try {
    loaded = await getActionPlanData();
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }
  const { recommendations, rows } = loaded;
  const plan = buildPlan(recommendations, rowsByView(rows), rows.functionExposure);
  const scope = planningScope(rows.functionExposure);

  const functionNames = plan.plans.map((p) => p.function).sort();
  const requested = first(params.function);
  const functionName = requested && functionNames.includes(requested) ? requested : null;
  const shown = functionName ? plan.plans.filter((p) => p.function === functionName) : plan.plans;
  const headcount = new Map(rows.functionExposure.map((r) => [r.function_name, r.headcount as number | null]));
  const generated = plan.generatedAt ? new Date(plan.generatedAt).toISOString().slice(0, 10) : null;

  return (
    <div className="min-h-screen">
      <SiteHeader active="/actions" datasetName="Built-in company" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">What should we do about it?</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              One move per function, written by the model from the exposure, adoption, sentiment, and skills views. Every
              recommendation cites the data points behind it; each one is checked against today&apos;s view rows below.
            </p>
          </div>
          {functionNames.length ? (
            <OverviewFilters functions={functionNames} functionName={functionName} weighting="cost" showWeighting={false} />
          ) : null}
        </div>

        {plan.plans.length === 0 ? (
          <Card className="mt-6">
            <CardHeading title="No plan yet" />
            <p className="text-sm text-muted-foreground">
              The planner hasn&apos;t written any recommendations. Run <code className="font-mono">npm run plan</code> or the
              &ldquo;Plan actions&rdquo; GitHub Action; it writes one per function to{" "}
              <code className="font-mono">fow.action_recommendations</code>.
            </p>
          </Card>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label="Functions with a plan"
                value={String(plan.plans.length)}
                note={
                  scope.skipped.length
                    ? `${scope.skipped.join(", ")} ${scope.skipped.length === 1 ? "has" : "have"} fewer than 10 people and no plan`
                    : "every function"
                }
              />
              <Kpi
                label="Most common move"
                value={[...plan.moves].sort((a, b) => b.count - a.count)[0].move.replace(/^./, (c) => c.toUpperCase())}
                note={plan.moves
                  .filter((m) => m.count)
                  .map((m) => `${m.count} ${m.move}`)
                  .join(", ")}
              />
              <Kpi
                label="Cited data points that match today"
                value={`${plan.evidence.matching} of ${plan.evidence.total}`}
                note={
                  plan.evidence.changed || plan.evidence.missing
                    ? `${plan.evidence.changed} changed and ${plan.evidence.missing} missing since the plan was written`
                    : `each recommendation cites at least ${MIN_METRIC_EVIDENCE}`
                }
              />
              <Kpi label="Generated" value={generated ?? "n/a"} note={`by ${plan.model ?? "unknown model"}, prompt actions-v1`} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {shown.map((p) => (
                <Card key={p.function} id={p.function}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{p.function}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {int(headcount.get(p.function) ?? null)} people · {MOVE_HELP[p.move] ?? p.move}
                      </p>
                    </div>
                    <MoveBadge move={p.move} />
                  </div>
                  <p className="mt-4">{p.text}</p>

                  <h3 className="mt-5 text-sm font-semibold">Evidence</h3>
                  <ul className="mt-1 divide-y divide-border/60">
                    {p.metrics.map((item, i) => (
                      <EvidenceItem key={i} item={item} />
                    ))}
                  </ul>
                  {!p.passes ? (
                    <p className="mt-2 text-sm font-medium text-destructive">
                      Fewer than {MIN_METRIC_EVIDENCE} of the cited data points still exist in the views.
                    </p>
                  ) : null}

                  {p.courses.length ? (
                    <>
                      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
                        <GraduationCap aria-hidden className="size-4" /> Suggested courses
                      </h3>
                      <ul className="mt-1">
                        {p.courses.map((c, i) => (
                          <li key={i} className="py-1.5 text-sm" title={`Source: ${c.source}`}>
                            <span className="font-medium">{c.value}</span>
                            <span className="text-muted-foreground"> · {c.label.replace(/^Course for /, "")}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {p.targets.length ? (
                    <>
                      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
                        <Route aria-hidden className="size-4" /> Redeployment targets
                      </h3>
                      <ul className="mt-1">
                        {p.targets.map((t, i) => (
                          <li key={i} className="py-1.5 text-sm" title={`Source: ${t.source}`}>
                            {t.label}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </Card>
              ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              <CircleCheck aria-hidden className="inline size-3.5 text-[#0F5B57]" /> matches the view today ·{" "}
              <TriangleAlert aria-hidden className="inline size-3.5 text-[#6B4E00]" /> value changed since the plan was
              written · <CircleX aria-hidden className="inline size-3.5 text-destructive" /> no longer in the view. Hover an item
              for its view, row, and column; linked items open the screen that shows it.
            </p>
            <SourceNote
              view="fow.action_recommendations"
              filter={`dataset_id = 'builtin', newest batch (created_at ${plan.generatedAt ?? "n/a"})`}
            />
          </>
        )}
      </main>
    </div>
  );
}
