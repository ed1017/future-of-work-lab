export function RateBar({ value, max = 1, tone = "bg-augment" }: { value: number | null; max?: number; tone?: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">Suppressed</span>;
  return (
    <div className="h-2.5 w-full min-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}
