import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(20,33,31,0.04)] sm:p-6", className)}
      {...props}
    />
  );
}

export function CardHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Where a number comes from: the view and filter, shown inline and as a hover title. */
export function SourceNote({ view, filter }: { view: string; filter?: string }) {
  const text = filter ? `${view} where ${filter}` : view;
  return (
    <p className="mt-3 text-xs text-muted-foreground" title={`Source: ${text}`}>
      Source: <code className="font-mono">{text}</code>
    </p>
  );
}
