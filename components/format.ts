export const pct = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(digits)}%`;

export const int = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : value.toLocaleString("en-US");

export const SUPPRESSED = "Suppressed (under 10 people)";
