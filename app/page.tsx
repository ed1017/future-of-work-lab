import { appRoutes } from "@/lib/routes";

// Milestone 1 placeholder. The real Overview (KPI tiles, quadrant, function
// bars, register preview, actions) lands in milestone 4.
export default function OverviewPage() {
  const primaryRoutes = appRoutes.filter((route) => route.href !== "/upload");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-semibold">Future of Work Lab</span>
            <span className="text-sm text-muted-foreground">synthetic data</span>
          </div>
          <nav aria-label="Primary" className="flex flex-wrap gap-1 text-sm">
            {primaryRoutes.map((route) => (
              <span
                key={route.href}
                aria-current={route.href === "/" ? "page" : undefined}
                className={
                  route.href === "/"
                    ? "rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
                    : "px-3 py-1.5 text-muted-foreground"
                }
              >
                {route.label}
              </span>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Where does AI change work here first?
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Task-level AI exposure, adoption, and governance for a synthetic
          company. This placeholder will be replaced by the Overview screen.
        </p>
      </main>
    </div>
  );
}
