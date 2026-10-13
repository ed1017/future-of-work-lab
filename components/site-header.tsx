import Link from "next/link";
import { appRoutes } from "@/lib/routes";

export function SiteHeader({ active, datasetName }: { active: string; datasetName?: string }) {
  const tabs = appRoutes.filter((r) => r.href !== "/upload");
  const upload = appRoutes.find((r) => r.href === "/upload");
  return (
    <header className="bg-header text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-heading text-2xl font-semibold">Future of Work Lab</span>
          <span className="text-sm text-white/70">
            {datasetName ? `${datasetName} · ` : ""}synthetic data
          </span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-sm">
          {tabs.map((route) => {
            const isActive = route.href === active;
            const live = ["/", "/exposure", "/adoption", "/governance", "/actions"].includes(route.href);
            const classes = isActive
              ? "rounded-lg bg-white px-3 py-2 font-medium text-foreground"
              : "rounded-lg px-3 py-2 text-white/80 hover:bg-white/10";
            return live ? (
              <Link key={route.href} href={route.href} aria-current={isActive ? "page" : undefined} className={classes}>
                {route.label}
              </Link>
            ) : (
              <span key={route.href} className="rounded-lg px-3 py-2 text-white/40" title="Coming in a later milestone">
                {route.label}
              </span>
            );
          })}
          {upload ? (
            <span
              className="ml-2 rounded-lg bg-primary/60 px-4 py-2 font-medium text-white/70"
              title="Coming in a later milestone"
            >
              {upload.label}
            </span>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
