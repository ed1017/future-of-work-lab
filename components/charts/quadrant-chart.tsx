"use client";

import {
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { pct, int } from "@/components/format";

export type QuadrantPoint = {
  key: string;
  function: string;
  family: string;
  x: number;
  y: number;
  headcount: number;
  zone: string;
};

type Props = { points: QuadrantPoint[]; xMid: number | null; yMid: number | null; labeledKeys: string[] };

const ZONE_COLOR: Record<string, string> = {
  "Enable first": "var(--enable)",
  "Govern & scale": "var(--govern)",
  Monitor: "var(--govern)",
  "Check for shadow AI": "var(--govern)",
};

export function QuadrantChart({ points, xMid, yMid, labeledKeys }: Props) {
  const xMax = Math.min(1, Math.max(0.5, Math.ceil(Math.max(...points.map((p) => p.x), 0) * 10) / 10 + 0.05));
  const yMax = 1;
  const labeled = new Set(labeledKeys);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 z-10 hidden text-xs font-semibold sm:block">
        <span className="absolute left-[76px] top-3 text-automate">Enable first</span>
        <span className="absolute right-4 top-3 text-primary">Govern &amp; scale</span>
        <span className="absolute bottom-[4.5rem] left-[76px] text-foreground/70">Monitor</span>
        <span className="absolute bottom-[4.5rem] right-4 text-primary">Check for shadow AI</span>
      </div>
      <div role="img" aria-label="Exposure by adoption for each job family; bubble size is headcount" style={{ height: 500 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
            {xMid !== null && yMid !== null ? (
              <ReferenceArea x1={0} x2={xMid} y1={yMid} y2={yMax} fill="var(--muted)" fillOpacity={0.9} ifOverflow="hidden" />
            ) : null}
            {xMid !== null ? <ReferenceLine x={xMid} stroke="var(--muted-foreground)" strokeDasharray="3 3" /> : null}
            {yMid !== null ? <ReferenceLine y={yMid} stroke="var(--muted-foreground)" strokeDasharray="3 3" /> : null}
            <XAxis
              type="number"
              dataKey="x"
              name="Adoption"
              domain={[0, xMax]}
              tickFormatter={(v) => pct(Number(v))}
              tick={{ fontSize: 12 }}
              label={{ value: "AI adoption (weekly active share) →", position: "insideBottom", offset: -16, fontSize: 12, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Exposure"
              domain={[0, yMax]}
              tickFormatter={(v) => pct(Number(v))}
              tick={{ fontSize: 12 }}
              width={60}
              label={{ value: "AI exposure score →", angle: -90, position: "insideLeft", offset: 4, fontSize: 12, fill: "var(--muted-foreground)" }}
            />
            <ZAxis type="number" dataKey="headcount" range={[90, 1100]} name="Headcount" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as QuadrantPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md">
                    <p className="font-semibold">{p.family}</p>
                    <p className="text-muted-foreground">{p.function}</p>
                    <p className="mt-1">Exposure {pct(p.y, 1)} · Adoption {pct(p.x, 1)}</p>
                    <p>{int(p.headcount)} people · {p.zone}</p>
                  </div>
                );
              }}
            />
            <Scatter data={points} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.key} fill={ZONE_COLOR[p.zone]} fillOpacity={0.88} stroke="#fff" />
              ))}
              <LabelList
                dataKey="family"
                position="right"
                content={(props) => {
                  const { x, y, index } = props as { x?: number; y?: number; index?: number };
                  const point = index === undefined ? undefined : points[index];
                  if (!point || !labeled.has(point.key) || x === undefined || y === undefined) return null;
                  const gap = Math.max(10, Math.min(Math.sqrt(point.headcount) * 0.55, 22)) + 4;
                  const left = point.x > xMax * 0.6;
                  return (
                    <text
                      x={left ? x - gap : x + gap}
                      y={y}
                      dy={4}
                      fontSize={12}
                      textAnchor={left ? "end" : "start"}
                      fill="var(--foreground)"
                    >
                      {point.family}
                    </text>
                  );
                }}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
