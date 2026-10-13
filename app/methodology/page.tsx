import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { Card, CardHeading, SourceNote } from "@/components/card";
import { LoadError } from "@/components/load-error";
import { SiteHeader } from "@/components/site-header";
import { getAdmin } from "@/lib/admin/auth";
import { describeLoadError, getMethodologyData } from "@/lib/data/fow";
import { DICTIONARY, LIMITS } from "@/lib/validation/dictionary.mjs";
import { LABELS, RETEST_SIZE, SAMPLE_SIZE } from "@/lib/validation/metrics.mjs";

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-heading text-4xl font-semibold">{value}</p>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

function Confusion({ rows, rowTitle, colTitle }: { rows: Record<string, Record<string, number>>; rowTitle: string; colTitle: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] text-left text-sm">
        <caption className="sr-only">
          {rowTitle} by {colTitle}
        </caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">
              {rowTitle} ↓ / {colTitle} →
            </th>
            {LABELS.map((l) => (
              <th key={l} className="py-2 pr-3 font-medium capitalize">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LABELS.map((m) => (
            <tr key={m} className="border-b border-border/70 last:border-0">
              <th scope="row" className="py-2 pr-3 font-medium capitalize">
                {m}
              </th>
              {LABELS.map((h) => (
                <td key={h} className={`py-2 pr-3 tabular-nums ${m === h ? "font-semibold" : "text-muted-foreground"}`}>
                  {rows[m][h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MethodologyPage() {
  let data;
  let prompt = "";
  try {
    data = await getMethodologyData();
    prompt = await readFile(path.join(process.cwd(), "prompts", "exposure-v1.md"), "utf8");
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }
  const admin = await getAdmin();
  const promptSha = createHash("sha256").update(prompt).digest("hex");
  const { runs, validation, stability } = data;
  const lastRun = runs.find((r) => r.status === "succeeded");
  const totalCost = runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  return (
    <div className="min-h-screen">
      <SiteHeader active="/methodology" datasetName="Built-in company" />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">How the exposure scores are made, and how far to trust them</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              The rubric, the exact prompt, the check of the model&apos;s labels against a human reviewer, and what the scores cannot tell you.
            </p>
          </div>
          {admin ? (
            <Link href="/admin/review" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Label the sample
            </Link>
          ) : null}
        </div>

        <Card>
          <CardHeading title="Validation result" subtitle={`${SAMPLE_SIZE} tasks, drawn about a third from each label the model gave, were labeled blind by a reviewer.`} />
          {!data.setUp ? (
            <p className="text-sm text-muted-foreground">The validation tables are not set up yet.</p>
          ) : !validation ? (
            <p className="text-sm text-muted-foreground">The validation sample has not been drawn yet.</p>
          ) : validation.reviewed === 0 ? (
            <p className="text-sm text-muted-foreground">The sample of {validation.sampleSize} tasks is drawn but not labeled yet. Agreement and kappa appear here once it is.</p>
          ) : (
            <>
              {!validation.complete ? (
                <p className="mb-4 rounded-lg bg-[#FBEFC4] px-3 py-2 text-sm text-[#6B4E00]">
                  Preliminary: {validation.reviewed} of {validation.sampleSize} sampled tasks are labeled so far.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Percent agreement" value={pct(validation.agreement)} note={`${validation.agreed} of ${validation.reviewed} tasks`} />
                <Stat label="Cohen's kappa" value={num(validation.kappa)} note={validation.kappaBand ? `${validation.kappaBand} agreement` : null} />
                <Stat label="Agreement, all tasks" value={pct(validation.weightedAgreement)} note="each label weighted by how often the model used it" />
                <Stat label="Test-retest stability" value={stability ? pct(stability.stability) : "Not run"} note={stability ? `${stability.same} of ${stability.tasks} re-scored tasks kept their label` : `${RETEST_SIZE} tasks re-scored once`} />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Model label vs reviewer label</h3>
                  <Confusion rows={validation.confusion} rowTitle="Model" colTitle="Reviewer" />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Agreement by model label</h3>
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Model label</th>
                        <th className="py-2 pr-3 font-medium">Reviewed</th>
                        <th className="py-2 pr-3 font-medium">Agreed</th>
                        <th className="py-2 font-medium">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.perLabel.map((p) => (
                        <tr key={p.label} className="border-b border-border/70 last:border-0">
                          <td className="py-2 pr-3 font-medium capitalize">{p.label}</td>
                          <td className="py-2 pr-3 tabular-nums">{p.reviewed}</td>
                          <td className="py-2 pr-3 tabular-nums">{p.agreed}</td>
                          <td className="py-2 tabular-nums">{p.reviewed ? pct(p.agreed / p.reviewed) : "n/a"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {stability ? (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold">Test-retest: first pass vs second pass{stability.kappa !== null ? ` (kappa ${num(stability.kappa)})` : ""}</h3>
                  <Confusion rows={stability.confusion} rowTitle="First" colTitle="Second" />
                </div>
              ) : null}
            </>
          )}
          <SourceNote view="fow.score_reviews, fow.validation_sample, fow.retest_scores" filter="one reviewer; kappa on the sampled tasks as drawn" />
        </Card>

        <Card>
          <CardHeading title="Rubric" subtitle="Version 1. Each O*NET task statement gets exactly one label." />
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Label</th>
                <th className="py-2 pr-3 font-medium">Definition</th>
                <th className="py-2 font-medium">Exposure</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["automate", "Current AI tools can complete the task end to end; a person reviews the output.", "1.0"],
                ["augment", "AI cuts the time a skilled person needs by roughly half or more, but a person still does the work.", "0.5"],
                ["unaffected", "Physical, relational, or judgment-heavy work where AI saves little time today.", "0.0"],
              ].map(([l, d, e]) => (
                <tr key={l} className="border-b border-border/70 align-top last:border-0">
                  <td className="py-2 pr-3 font-medium capitalize">{l}</td>
                  <td className="py-2 pr-3">{d}</td>
                  <td className="py-2 tabular-nums">{e}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-primary">Show the full prompt</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-xs">{prompt}</pre>
          </details>
          <p className="mt-3 text-xs text-muted-foreground">
            Prompt hash <code className="font-mono">{promptSha.slice(0, 12)}</code>
            {lastRun ? (lastRun.prompt_sha === promptSha ? " matches the latest run." : " differs from the latest run; the prompt changed after it.") : "."} Temperature 0 where the model allows it.
          </p>
          <SourceNote view="prompts/exposure-v1.md" />
        </Card>

        <Card>
          <CardHeading title="Scoring runs" subtitle={`${runs.length} runs, $${totalCost.toFixed(4)} in total. Each run records its model, rubric, prompt hash, and cost.`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Rubric</th>
                  <th className="py-2 pr-3 font-medium">Prompt</th>
                  <th className="py-2 pr-3 font-medium">Tasks</th>
                  <th className="py-2 pr-3 font-medium">Cost</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_id} className="border-b border-border/70 last:border-0">
                    <td className="py-2 pr-3">{r.started_at.slice(0, 10)}</td>
                    <td className="py-2 pr-3">{r.model}</td>
                    <td className="py-2 pr-3">{r.rubric_version}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.prompt_sha.slice(0, 12)}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.tasks_scored}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.cost_usd === null ? "n/a" : `$${Number(r.cost_usd).toFixed(4)}`}</td>
                    <td className="py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote view="fow.scoring_runs" />
        </Card>

        <Card>
          <CardHeading title="Limits" subtitle="Read these before using any number on the other screens." />
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeading title="Data dictionary" subtitle="What each measure means and where it comes from." />
          <dl className="divide-y divide-border/70 text-sm">
            {DICTIONARY.map((d) => (
              <div key={d.term} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr_16rem]">
                <dt className="font-medium">{d.term}</dt>
                <dd>{d.meaning}</dd>
                <dd className="font-mono text-xs text-muted-foreground">{d.source}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </main>
    </div>
  );
}
