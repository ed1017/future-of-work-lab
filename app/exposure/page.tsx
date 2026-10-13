import Link from "next/link";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { int, pct } from "@/components/format";
import { OverviewFilters } from "@/components/overview-filters";
import { SiteHeader } from "@/components/site-header";
import { LoadError } from "@/components/load-error";
import { DEFAULT_DATASET, describeLoadError, getJobTasks, getOverviewData } from "@/lib/data/fow";
import { buildExposureDrilldown, jobTaskDetail, normalizeWeighting } from "@/lib/overview/metrics.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const LABEL_STYLE: Record<string, string> = {
  automate: "bg-[#F3DDD2] text-[#8A3A15]",
  augment: "bg-[#DDEFEA] text-[#0F5B57]",
  unaffected: "bg-muted text-muted-foreground",
};

function ShareBar({ automate, augment }: { automate: number | null; augment: number | null }) {
  if (automate === null || augment === null) return <span className="text-xs text-muted-foreground">Not scored</span>;
  return (
    <div className="flex h-2.5 w-full min-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="bg-automate" style={{ width: `${automate * 100}%` }} />
      <div className="bg-augment" style={{ width: `${augment * 100}%` }} />
    </div>
  );
}

export default async function ExposurePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const weighting = normalizeWeighting(first(params.weighting));
  let loaded;
  try {
    loaded = await getOverviewData();
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }
  const { data, info } = loaded;

  const functionNames = data.functionExposure
    .filter((r) => !r.is_total && r.function_name)
    .map((r) => r.function_name as string)
    .sort();
  const requested = first(params.function);
  const functionName = requested && functionNames.includes(requested) ? requested : null;
  const drill = buildExposureDrilldown(data, { functionName, weighting });

  const jobKey = first(params.job);
  const job = functionName ? data.jobs.find((j) => j.job_key === jobKey && j.function_name === functionName) : undefined;
  let tasks: Awaited<ReturnType<typeof getJobTasks>> | null = null;
  if (job) {
    try {
      tasks = await getJobTasks(DEFAULT_DATASET, job.job_key);
    } catch (error) {
      return <LoadError message={describeLoadError(error)} />;
    }
  }
  const detail = tasks ? jobTaskDetail(tasks.jobTasks, tasks.scores) : null;

  const link = (next: { function?: string | null; job?: string | null }) => {
    const q = new URLSearchParams();
    if (next.function) q.set("function", next.function);
    if (next.job) q.set("job", next.job);
    if (weighting !== "cost") q.set("weighting", weighting);
    const s = q.toString();
    return s ? `/exposure?${s}` : "/exposure";
  };

  return (
    <div className="min-h-screen">
      <SiteHeader active="/exposure" datasetName={info.name} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Which work is most exposed?</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Drill from function to job family to job, then to the tasks and the model&apos;s rationale. Exposure is task
              overlap with AI capability, not job loss.
            </p>
          </div>
          <OverviewFilters functions={functionNames} functionName={functionName} weighting={weighting} />
        </div>

        <nav aria-label="Breadcrumb" className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link className="text-primary underline underline-offset-4" href={link({})}>
            All functions
          </Link>
          {functionName ? (
            <>
              <span>/</span>
              <Link className="text-primary underline underline-offset-4" href={link({ function: functionName })}>
                {functionName}
              </Link>
            </>
          ) : null}
          {job ? (
            <>
              <span>/</span>
              <span className="text-foreground">{job.title}</span>
            </>
          ) : null}
        </nav>

        <Card className="mt-4">
          <CardHeading
            title="Exposure by function"
            subtitle={`Exposure score is ${weighting === "cost" ? "labor-cost" : "headcount"}-weighted. Select a function for its families and jobs.`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Function</th>
                  <th className="w-1/3 py-2 pr-3 font-medium">Automate / augment share</th>
                  <th className="py-2 pr-3 text-right font-medium">Exposed</th>
                  <th className="py-2 pr-3 text-right font-medium">Score</th>
                  <th className="py-2 text-right font-medium">Headcount</th>
                </tr>
              </thead>
              <tbody>
                {drill.bars.map((b) => (
                  <tr key={b.function} className={`border-b border-border/70 last:border-0 ${b.function === functionName ? "bg-accent/50" : ""}`}>
                    <td className="py-3 pr-3 font-medium">
                      <Link className="text-primary underline-offset-4 hover:underline" href={link({ function: b.function })}>
                        {b.function}
                      </Link>
                    </td>
                    <td className="py-3 pr-3">{b.suppressed ? <span className="text-xs text-muted-foreground">Suppressed (under 10 people)</span> : <ShareBar automate={b.automate} augment={b.augment} />}</td>
                    <td className="py-3 pr-3 text-right">{pct(b.exposed)}</td>
                    <td className="py-3 pr-3 text-right">{pct(b.score)}</td>
                    <td className="py-3 text-right">{b.suppressed ? "n/a" : int(b.headcount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote view="fow.v_function_exposure" filter="is_total = false" />
        </Card>

        {functionName ? (
          <Card className="mt-4">
            <CardHeading title={`${functionName}: families and jobs`} subtitle="Sorted by exposure score. Select a job to see its tasks." />
            <div className="space-y-6">
              {drill.families.map((f) => (
                <div key={f.family}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{f.family}</h3>
                    <p className="text-sm text-muted-foreground">
                      {f.suppressed ? "Suppressed (under 10 people)" : `${pct(f.score)} exposure score · ${int(f.headcount)} people`}
                    </p>
                  </div>
                  <ul className="mt-2 divide-y divide-border/70 rounded-xl border border-border">
                    {f.jobs.map((j) => (
                      <li key={j.jobKey} className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1.4fr_1fr_5rem_6rem] ${j.jobKey === job?.job_key ? "bg-accent/50" : ""}`}>
                        <Link className="font-medium text-primary underline-offset-4 hover:underline" href={link({ function: functionName, job: j.jobKey })}>
                          {j.title}
                        </Link>
                        <div className="col-span-2 sm:col-span-1 sm:row-auto">
                          <ShareBar automate={j.automate} augment={j.augment} />
                        </div>
                        <span className="text-right text-sm">{pct(j.score)}</span>
                        <span className="text-right text-sm text-muted-foreground">{j.suppressed ? "Suppressed" : `${int(j.headcount)} people`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <SourceNote view="fow.v_job_exposure + fow.v_exposure_adoption" filter={`function_name = '${functionName}'; families at level = family`} />
          </Card>
        ) : null}

        {job && detail ? (
          <Card className="mt-4">
            <CardHeading
              title={`${job.title}: tasks`}
              subtitle={`Each task's share of the job's time, the model's label, and why. Job exposure score ${pct(detail.exposureScore, 1)} = Σ time share × exposure; ${pct(detail.coverage)} of task time scored.`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Task</th>
                    <th className="py-2 pr-3 text-right font-medium">Time share</th>
                    <th className="py-2 pr-3 font-medium">Label</th>
                    <th className="py-2 pr-3 font-medium">Confidence</th>
                    <th className="py-2 font-medium">Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.tasks.map((t) => (
                    <tr key={t.taskId} className="border-b border-border/70 align-top last:border-0">
                      <td className="max-w-md py-3 pr-3">{t.text}</td>
                      <td className="py-3 pr-3 text-right">{pct(t.timeShare, 1)}</td>
                      <td className="py-3 pr-3">
                        {t.label ? (
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${LABEL_STYLE[t.label]}`}>{t.label}</span>
                        ) : (
                          <span className="text-muted-foreground">Not scored</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 capitalize text-muted-foreground">{t.confidence ?? "n/a"}</td>
                      <td className="py-3 text-muted-foreground">{t.rationale ?? "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SourceNote view="fow.job_tasks + fow.task_exposure_scores" filter={`dataset_id = '${DEFAULT_DATASET}' and job_key = '${job.job_key}'; latest succeeded run per task`} />
          </Card>
        ) : null}
      </main>
    </div>
  );
}
