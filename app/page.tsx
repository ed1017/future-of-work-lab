import Link from "next/link";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { FunctionBars } from "@/components/charts/function-bars";
import { QuadrantChart } from "@/components/charts/quadrant-chart";
import { int, pct, SUPPRESSED } from "@/components/format";
import { OverviewFilters } from "@/components/overview-filters";
import { SiteHeader } from "@/components/site-header";
import { LoadError } from "@/components/load-error";
import { MoveBadge } from "@/components/move-badge";
import { describeLoadError, getOverviewData } from "@/lib/data/fow";
import { buildOverview, normalizeWeighting } from "@/lib/overview/metrics.mjs";
import { topActions } from "@/lib/actions/screen.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TIER_STYLE: Record<string, string> = {
  high: "bg-[#FBE3DA] text-[#8A2F14]",
  medium: "bg-[#FBEFC4] text-[#6B4E00]",
  low: "bg-[#DDEFEA] text-[#0F5B57]",
};

function Kpi({ label, value, note, title }: { label: string; value: string; note: string; title: string }) {
  return (
    <Card className="p-5" title={title}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-heading text-4xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{note}</p>
    </Card>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const weighting = normalizeWeighting(first(params.weighting));
  let loaded;
  try {
    loaded = await getOverviewData();
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }
  const { data, info } = loaded;
  const actions = topActions(loaded.actions, data.functionExposure);

  const functionNames = data.functionExposure
    .filter((r) => !r.is_total && r.function_name)
    .map((r) => r.function_name as string)
    .sort();
  const requested = first(params.function);
  const functionName = requested && functionNames.includes(requested) ? requested : null;

  const o = buildOverview(data, { functionName, weighting });
  const scope = functionName ?? "all roles";
  const weightLabel = weighting === "cost" ? "Cost-weighted" : "Headcount-weighted";
  const filterText = functionName ? `function_name = '${functionName}'` : "is_total / level = company";

  return (
    <div className="min-h-screen">
      <SiteHeader active="/" datasetName={info.name} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Where does AI change work here first?</h1>
            <p className="mt-2 text-muted-foreground">
              Task-level exposure, adoption, and governance across {int(info.headcount)} employees in {info.functions} functions.
            </p>
          </div>
          <OverviewFilters functions={functionNames} functionName={functionName} weighting={weighting} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label={`${weightLabel} AI exposure`}
            value={o.kpis.exposure.suppressed ? "n/a" : pct(o.kpis.exposure.value)}
            note={
              o.kpis.exposure.suppressed
                ? SUPPRESSED
                : `exposure score of task time (automate = 1, augment = ½), ${scope}`
            }
            title={`Source: fow.v_function_exposure where ${filterText}; column exposure_score_${weighting === "cost" ? "cost" : "hc"}`}
          />
          <Kpi
            label="Weekly active AI users"
            value={o.kpis.adoption.suppressed ? "n/a" : pct(o.kpis.adoption.rate)}
            note={
              o.kpis.adoption.suppressed
                ? SUPPRESSED
                : `of licensed employees (${int(o.kpis.adoption.activeUsers)} of ${int(o.kpis.adoption.licensed)}), ${scope}`
            }
            title={`Source: fow.v_exposure_adoption where ${functionName ? `level = function and function_name = '${functionName}'` : "level = company"}; column weekly_active_rate_licensed`}
          />
          <Kpi
            label="HR AI use cases"
            value={int(o.kpis.useCases.total)}
            note={`${o.kpis.useCases.highRisk} high-risk, ${o.kpis.useCases.overdue} overdue for review`}
            title="Source: fow.v_register; count of rows, risk_tier = high, is_overdue = true"
          />
          <Kpi
            label="Roles flagged for redesign"
            value={int(o.kpis.redesign.roles)}
            note={`${int(o.kpis.redesign.employees)} employees in scope · exposure score ${pct(o.kpis.redesign.threshold)} or higher`}
            title={`Source: fow.v_job_exposure where exposure_score >= ${o.kpis.redesign.threshold}${functionName ? ` and function_name = '${functionName}'` : ""}`}
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <Card>
            <CardHeading
              title="Exposure × adoption, by role family"
              subtitle="Bubble size = headcount. Top-left (more exposed, less adopted than the company) is where enablement pays off first."
            />
            {o.quadrant.points.length ? (
              <QuadrantChart
                points={o.quadrant.points}
                xMid={o.quadrant.xMid}
                yMid={o.quadrant.yMid}
                labeledKeys={o.quadrant.labeledKeys}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No job families to show for this filter.</p>
            )}
            <SourceNote
              view="fow.v_exposure_adoption"
              filter={`level = family${functionName ? ` and function_name = '${functionName}'` : ""}; dividing lines are the company values`}
            />
            {o.quadrant.hiddenFamilies ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {o.quadrant.hiddenFamilies} family hidden: fewer than 10 people.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeading
              title="Exposure by function"
              subtitle="Share of task time that is automate or augment, largest first."
              action={
                <Link className="shrink-0 text-sm text-primary underline underline-offset-4" href={`/exposure${weighting === "headcount" ? "?weighting=headcount" : ""}`}>
                  Drill down →
                </Link>
              }
            />
            <FunctionBars bars={o.bars.filter((b) => !b.suppressed)} selected={functionName} />
            <SourceNote view="fow.v_function_exposure" filter={`is_total = false; ${weightLabel.toLowerCase()} shares`} />
            {o.bars.some((b) => b.suppressed) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Hidden, fewer than 10 people: {o.bars.filter((b) => b.suppressed).map((b) => b.function).join(", ")}.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <Card>
            <CardHeading
              title="HR AI governance register"
              subtitle={`Highest risk first. Showing ${o.register.length} of ${o.kpis.useCases.total} use cases.`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Use case</th>
                    <th className="py-2 pr-3 font-medium">Risk tier</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium">Human in loop</th>
                    <th className="py-2 font-medium">Review status</th>
                  </tr>
                </thead>
                <tbody>
                  {o.register.map((r) => (
                    <tr key={r.use_case_id} className="border-b border-border/70 last:border-0">
                      <td className="py-3 pr-3 font-medium">{r.name}</td>
                      <td className="py-3 pr-3">
                        {r.risk_tier ? (
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${TIER_STYLE[r.risk_tier] ?? ""}`}>
                            {r.risk_tier}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unrated</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.owner ?? "n/a"}</td>
                      <td className="py-3 pr-3">{r.human_in_loop === null ? "n/a" : r.human_in_loop ? "Yes" : "No"}</td>
                      <td className={`py-3 ${r.is_overdue ? "font-semibold text-destructive" : ""}`}>{r.review_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SourceNote view="fow.v_register" filter="top 5 by risk_tier, then is_overdue" />
          </Card>

          <Card>
            <CardHeading
              title="Recommended actions"
              subtitle="Generated by the model, traced to the data behind each one."
              action={
                <Link className="shrink-0 text-sm text-primary underline underline-offset-4" href="/actions">
                  Full plan →
                </Link>
              }
            />
            {actions.length ? (
              <ul className="space-y-3">
                {actions.map((a) => (
                  <li key={`${a.scope_key}-${a.move}`} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/actions?function=${encodeURIComponent(a.scope_key)}`} className="font-semibold hover:text-primary">
                        {a.scope_key}
                      </Link>
                      <MoveBadge move={a.move} />
                    </div>
                    <p className="mt-2 text-sm">{a.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No recommendations yet. The action planner writes one per function from these views.
              </p>
            )}
            <SourceNote view="fow.action_recommendations" filter="newest batch; redesign, redeploy, reskill, hold, then most exposed" />
          </Card>
        </div>
      </main>
    </div>
  );
}
