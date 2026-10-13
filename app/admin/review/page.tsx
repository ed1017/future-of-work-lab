import Link from "next/link";
import { drawSampleAction, saveReviewAction } from "./actions";
import { signOutAction } from "@/app/admin/actions";
import { Card, CardHeading } from "@/components/card";
import { LoadError } from "@/components/load-error";
import { SiteHeader } from "@/components/site-header";
import { getAdmin } from "@/lib/admin/auth";
import { describeLoadError, getReviewQueue } from "@/lib/data/fow";
import { LABELS, SAMPLE_SIZE } from "@/lib/validation/metrics.mjs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DEFINITIONS: Record<(typeof LABELS)[number], { name: string; text: string }> = {
  automate: { name: "Automate", text: "Current AI tools can complete the task end to end; a person reviews the output. (exposure 1.0)" },
  augment: { name: "Augment", text: "AI cuts the time a skilled person needs by roughly half or more, but a person still does the work. (0.5)" },
  unaffected: { name: "Unaffected", text: "Physical, relational, or judgment-heavy work where AI saves little time today. (0.0)" },
};

const NOTICES: Record<string, string> = {
  drawn: "The sample was drawn.",
  exists: "A sample already exists, so nothing was changed.",
  failed: "That didn't save. Try again.",
  invalid: "Pick one of the three labels.",
  done: "Every task in the sample has your label.",
};

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const admin = await getAdmin();
  if (!admin) {
    return (
      <div className="min-h-screen">
        <SiteHeader active="/methodology" />
        <main className="mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-3xl font-semibold">Validation review</h1>
          <p className="mt-3 text-muted-foreground">Only the admin can label the validation sample.</p>
          <Link href="/admin/sign-in" className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Admin sign-in
          </Link>
        </main>
      </div>
    );
  }

  let queue;
  try {
    queue = await getReviewQueue(admin);
  } catch (error) {
    return <LoadError message={describeLoadError(error)} />;
  }

  const notice = NOTICES[first(params.notice) ?? ""] ?? null;
  const done = queue.sample.filter((t) => t.reviewed).length;
  const wanted = Number(first(params.task));
  const current = queue.sample.find((t) => t.task_id === wanted) ?? queue.sample.find((t) => !t.reviewed) ?? null;
  const following = current ? (queue.sample.find((t) => !t.reviewed && t.position > current.position && t.task_id !== current.task_id) ?? queue.sample.find((t) => !t.reviewed && t.task_id !== current.task_id)) : null;

  return (
    <div className="min-h-screen">
      <SiteHeader active="/methodology" />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Validation review</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Label each task yourself using the rubric. The model&apos;s label stays hidden until the results are computed, so it can&apos;t sway you.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/methodology" className="rounded-lg border border-input px-4 py-2">
              Methodology
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="rounded-lg border border-input px-4 py-2">
                Sign out
              </button>
            </form>
          </div>
        </div>
        {notice ? (
          <p role="status" className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}

        {!queue.setUp ? (
          <Card className="mt-6">
            <CardHeading title="Database step needed" subtitle="The validation tables don't exist yet. Run the milestone 7 migration (supabase/migrations/20261013060000_fow_validation.sql) in the Supabase SQL editor, then reload." />
          </Card>
        ) : queue.sample.length === 0 ? (
          <Card className="mt-6">
            <CardHeading
              title={`Draw the ${SAMPLE_SIZE}-task sample`}
              subtitle={`${queue.eligible} tasks have a score. The sample takes about a third from each label the model gave (automate, augment, unaffected), chosen with a fixed seed so it can be reproduced. It is drawn once.`}
            />
            <form action={drawSampleAction}>
              <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
                Draw sample
              </button>
            </form>
          </Card>
        ) : (
          <>
            <div className="mt-6 flex items-center gap-4">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={queue.sample.length}>
                <div className="h-full bg-primary" style={{ width: `${(done / queue.sample.length) * 100}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">
                {done} of {queue.sample.length} labeled
              </p>
            </div>

            {current ? (
              <Card className="mt-4">
                <CardHeading
                  title={`Task ${current.position} of ${queue.sample.length}`}
                  subtitle={current.occupation_titles.length ? `Company roles that use this occupation: ${current.occupation_titles.join(", ")}` : undefined}
                />
                <blockquote className="border-l-4 border-primary/40 pl-4 text-lg">{current.task_text}</blockquote>
                <form action={saveReviewAction} className="mt-6 space-y-4">
                  <input type="hidden" name="task_id" value={current.task_id} />
                  <input type="hidden" name="next" value={following?.task_id ?? ""} />
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Your label</legend>
                    {LABELS.map((l) => (
                      <label key={l} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                        <input type="radio" name="label" value={l} required defaultChecked={current.my_label === l} className="mt-1" />
                        <span className="text-sm">
                          <span className="font-semibold">{DEFINITIONS[l].name}.</span> {DEFINITIONS[l].text}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="block text-sm">
                    Note (optional)
                    <textarea name="note" maxLength={500} rows={2} defaultValue={current.note ?? ""} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40" />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Judge against AI tools widely available to a company today, not prototypes. Choose automate only if the whole task can be done by AI with a person checking the result.
                  </p>
                  <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
                    {following ? "Save and next" : "Save"}
                  </button>
                </form>
              </Card>
            ) : (
              <Card className="mt-4">
                <CardHeading title="All done" subtitle="Every task in the sample has your label. The results are on the Methodology page." />
                <Link href="/methodology" className="text-primary underline underline-offset-4">
                  See agreement and kappa
                </Link>
              </Card>
            )}

            <Card className="mt-4">
              <CardHeading title="All tasks" subtitle="Pick one to label or change your label." />
              <ol className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                {queue.sample.map((t) => (
                  <li key={t.task_id}>
                    <Link
                      href={`/admin/review?task=${t.task_id}`}
                      aria-label={`Task ${t.position}${t.reviewed ? ", labeled" : ", not labeled"}`}
                      className={`block rounded-lg border py-2 text-center text-sm ${t.reviewed ? "border-primary/40 bg-primary/10" : "border-border"} ${current?.task_id === t.task_id ? "ring-2 ring-primary" : ""}`}
                    >
                      {t.position}
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
