import Link from "next/link";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { int, pct } from "@/components/format";
import { LoadError } from "@/components/load-error";
import { OverviewFilters } from "@/components/overview-filters";
import { RateBar } from "@/components/rate-bar";
import { SiteHeader } from "@/components/site-header";
import { describeLoadError, getAdoptionData } from "@/lib/data/fow";
import { adoptionByFunction, enableFirst, managerTeams, pulseSummary, toolMix } from "@/lib/adoption/metrics.mjs";
import { normalizeWeighting } from "@/lib/overview/metrics.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-heading text-4xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{note}</p>
    </Card>
  );
}

const signedPoints = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)} pts`);

export default async function AdoptionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const weighting = normalizeWeighting(first(params.weighting));
  let loaded;
  try {
    loaded = await getAdoptionData();
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }

  const byFunction = adoptionByFunction(loaded.adoption);
  const teams = managerTeams(loaded.managers);
  const tools = toolMix(loaded.tools);
  const pulse = pulseSummary(loaded.pulse);
  const functionNames = byFunction.rows.map((r) => r.function as string).sort();
  const requested = first(params.function);
  const functionName = requested && functionNames.includes(requested) ? requested : null;
  const enable = enableFirst(loaded.adoption, weighting);
  const shownFunctions = functionName ? byFunction.rows.filter((r) => r.function === functionName) : byFunction.rows;
  const shownTeams = functionName ? teams.filter((t) => t.label.startsWith(`${functionName} ·`)) : teams;
  const shownEnable = functionName ? enable.rows.filter((r) => r.function === functionName) : enable.rows;
  const company = byFunction.company;
  const shadowUsers = tools.filter((t) => !t.approved);

  return (
    <div className="min-h-screen">
      <SiteHeader active="/adoption" datasetName="Built-in company" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Who is using AI, and who is being left behind?</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Weekly active use of approved tools{company?.weekStart ? ` in the week of ${company.weekStart}` : ""}, how people
              feel about it, and where exposed work has the least adoption. Groups under 10 people are suppressed.
            </p>
          </div>
          <OverviewFilters functions={functionNames} functionName={functionName} weighting={weighting} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Kpi
            label="Weekly active AI users"
            value={pct(company?.weeklyActiveRate)}
            note={`of ${int(company?.headcount)} employees (${pct(company?.licensedRate)} are licensed)`}
          />
          <Kpi
            label="Shadow AI users"
            value={pct(company?.shadowRate)}
            note="used an unapproved tool in the last 4 weeks"
          />
          <Kpi
            label="Enable-first families"
            value={String(enable.rows.length)}
            note="more exposed and less adopted than the company"
          />
        </div>

        <Card className="mt-4">
          <CardHeading title="Active-user rate by function" subtitle="Share of each function's employees active on an approved tool in the latest week." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Function</th>
                  <th className="w-1/3 py-2 pr-3 font-medium">Weekly active</th>
                  <th className="py-2 pr-3 text-right font-medium">Active</th>
                  <th className="py-2 pr-3 text-right font-medium">Licensed</th>
                  <th className="py-2 text-right font-medium">Headcount</th>
                </tr>
              </thead>
              <tbody>
                {shownFunctions.map((r) => (
                  <tr key={r.function} className="border-b border-border/70 last:border-0">
                    <td className="py-3 pr-3 font-medium">{r.function}</td>
                    <td className="py-3 pr-3">
                      <RateBar value={r.weeklyActiveRate} />
                    </td>
                    <td className="py-3 pr-3 text-right">{r.suppressed ? "n/a" : pct(r.weeklyActiveRate)}</td>
                    <td className="py-3 pr-3 text-right">{r.suppressed ? "n/a" : pct(r.licensedRate)}</td>
                    <td className="py-3 text-right">{r.suppressed ? "Suppressed" : int(r.headcount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote view="fow.v_exposure_adoption" filter="level = 'function'; latest usage week" />
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeading
              title="Active-user rate by manager team"
              subtitle="Teams of 10 or more direct reports. Managers aren't named; teams are numbered within their function."
            />
            {shownTeams.length ? (
              <ul className="divide-y divide-border/70">
                {shownTeams.map((t) => (
                  <li key={t.label} className="grid grid-cols-[1fr_6rem_3rem] items-center gap-3 py-2.5 text-sm">
                    <span>
                      {t.label} <span className="text-muted-foreground">({int(t.headcount)} people)</span>
                    </span>
                    <RateBar value={t.weeklyActiveRate} />
                    <span className="text-right">{pct(t.weeklyActiveRate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No manager teams of 10 or more in this view.</p>
            )}
            <SourceNote view="fow.v_adoption_manager" filter="teams with 10 or more people" />
          </Card>

          <Card>
            <CardHeading title="Tool mix" subtitle="People active on each tool in the latest week. Unapproved tools are shadow AI." />
            <ul className="divide-y divide-border/70">
              {tools.map((t) => (
                <li key={t.tool_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium">
                    {t.name} <span className="font-normal text-muted-foreground">· {t.category}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {!t.approved ? (
                      <span className="rounded-full bg-[#FBE3DA] px-3 py-1 text-xs font-semibold text-[#8A2F14]">Shadow AI</span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {t.suppressed ? "Suppressed (under 10 people)" : `${int(t.weekly_active_users)} active${t.approved ? ` of ${int(t.licenses)} licensed` : ""}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {shadowUsers.length} unapproved {shadowUsers.length === 1 ? "tool" : "tools"} seen in usage.
            </p>
            <SourceNote view="fow.v_tool_mix" filter="latest usage week" />
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeading
            title="AI pulse"
            subtitle={`Share of favorable answers (4 or 5; the worry question is flipped). Latest wave ${pulse.latest ?? "n/a"}${pulse.previous ? `, change since ${pulse.previous}` : ""}.`}
          />
          <ul className="divide-y divide-border/70">
            {pulse.rows.map((q) => (
              <li key={q.code} className="grid grid-cols-1 items-center gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[1.6fr_1fr_4rem_5rem]">
                <span>{q.text}</span>
                <RateBar value={q.favorable} />
                <span className="text-right font-medium">{pct(q.favorable)}</span>
                <span className="text-right text-muted-foreground">{signedPoints(q.change)}</span>
              </li>
            ))}
          </ul>
          <SourceNote view="fow.v_pulse_sentiment" filter="level = 'company'" />
        </Card>

        <Card className="mt-4">
          <CardHeading
            title="Enable first"
            subtitle={`Job families more exposed (${weighting === "cost" ? "cost" : "headcount"}-weighted score above ${pct(enable.yMid)}) and less adopted (below ${pct(enable.xMid)} weekly active) than the company.`}
          />
          {shownEnable.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Job family</th>
                    <th className="py-2 pr-3 font-medium">Function</th>
                    <th className="py-2 pr-3 text-right font-medium">Exposure</th>
                    <th className="py-2 pr-3 text-right font-medium">Weekly active</th>
                    <th className="py-2 text-right font-medium">Headcount</th>
                  </tr>
                </thead>
                <tbody>
                  {shownEnable.map((r) => (
                    <tr key={`${r.function}/${r.family}`} className="border-b border-border/70 last:border-0">
                      <td className="py-3 pr-3 font-medium">{r.family}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{r.function}</td>
                      <td className="py-3 pr-3 text-right">{pct(r.exposure)}</td>
                      <td className="py-3 pr-3 text-right">{pct(r.weeklyActiveRate)}</td>
                      <td className="py-3 text-right">{int(r.headcount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No families fall in this quadrant for the current filter.</p>
          )}
          <p className="mt-3 text-sm">
            <Link className="text-primary underline underline-offset-4" href={weighting === "cost" ? "/" : "/?weighting=headcount"}>
              See the full quadrant on the Overview
            </Link>
          </p>
          <SourceNote view="fow.v_exposure_adoption" filter="level = 'family'; exposure above and weekly_active_rate below the company row" />
        </Card>
      </main>
    </div>
  );
}
