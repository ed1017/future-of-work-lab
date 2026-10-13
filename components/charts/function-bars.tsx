"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct } from "@/components/format";

export type FunctionBar = {
  function: string;
  automate: number | null;
  augment: number | null;
  exposed: number | null;
  headcount: number | null;
};

const ROW = 34;

export function FunctionBars({ bars, selected }: { bars: FunctionBar[]; selected?: string | null }) {
  const data = bars.map((b) => ({ ...b, name: b.function }));
  return (
    <div>
      <div role="img" aria-label="Automate and augment share of task time by function" style={{ height: data.length * ROW + 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap={10}>
            <XAxis type="number" domain={[0, 1]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              axisLine={false}
              tickLine={false}
              tick={({ x, y, payload }) => (
                <text
                  x={Number(x) - 4}
                  y={y}
                  dy={4}
                  textAnchor="end"
                  fontSize={13}
                  fontWeight={String(payload.value) === selected ? 700 : 400}
                  fill="var(--foreground)"
                >
                  {String(payload.value).length > 22 ? `${String(payload.value).slice(0, 21)}…` : payload.value}
                </text>
              )}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              formatter={(value, name) => [pct(Number(value), 1), name === "automate" ? "Automate" : "Augment"]}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="automate" stackId="s" fill="var(--automate)" background={{ fill: "var(--muted)", radius: 6 }} />
            <Bar dataKey="augment" stackId="s" fill="var(--augment)">
              <LabelList
                dataKey="exposed"
                position="right"
                formatter={(v) => pct(Number(v))}
                style={{ fontSize: 13, fill: "var(--foreground)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex gap-5 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-automate" /> Automate
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-augment" /> Augment
        </span>
      </div>
    </div>
  );
}
