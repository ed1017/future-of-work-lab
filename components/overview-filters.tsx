"use client";

import { usePathname, useRouter } from "next/navigation";

type Props = { functions: string[]; functionName: string | null; weighting: "cost" | "headcount" };

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function OverviewFilters({ functions, functionName, weighting }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const go = (next: { functionName?: string | null; weighting?: string }) => {
    const params = new URLSearchParams();
    const fn = next.functionName === undefined ? functionName : next.functionName;
    const w = next.weighting ?? weighting;
    if (fn) params.set("function", fn);
    if (w !== "cost") params.set("weighting", w);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Function
        <select
          className={selectClass}
          value={functionName ?? ""}
          onChange={(e) => go({ functionName: e.target.value || null })}
        >
          <option value="">All functions</option>
          {functions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Weighting
        <select className={selectClass} value={weighting} onChange={(e) => go({ weighting: e.target.value })}>
          <option value="cost">Cost-weighted</option>
          <option value="headcount">Headcount-weighted</option>
        </select>
      </label>
    </div>
  );
}
