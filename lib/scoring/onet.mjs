// O*NET Task Statements and Task Ratings (text release) to fow.task_statements rows.
// O*NET is published by USDOL/ETA under CC BY 4.0.

export const DEFAULT_ONET_RELEASE = "31.0";

/** @param {string} release e.g. "31.0" */
export const onetZipUrl = (release) =>
  `https://www.onetcenter.org/dl_files/database/db_${release.replace(/\./g, "_")}_text.zip`;

/**
 * Parse an O*NET tab-delimited file into objects keyed by its header row.
 * @param {string} text
 * @param {string[]} required column names that must be present
 */
export const parseTsv = (text, required = []) => {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("empty O*NET file");
  const header = lines[0].split("\t").map((h) => h.trim());
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`O*NET file is missing columns: ${missing.join(", ")}`);
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
};

export const STATEMENT_COLUMNS = ["O*NET-SOC Code", "Task ID", "Task", "Task Type"];
export const RATING_COLUMNS = ["O*NET-SOC Code", "Task ID", "Scale ID", "Category", "Data Value"];

const num = (v) => {
  const n = Number(v);
  return v !== "" && Number.isFinite(n) ? n : null;
};

const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Build task_statements rows for the given occupations.
 * importance = the IM rating (1-5). frequency = the expected FT category (1 = yearly or
 * less ... 7 = hourly or more), weighted by the percent of incumbents in each category.
 * A task without a rating gets its occupation's mean, so every O*NET task can get a time share.
 *
 * @param {{ statements: string, ratings: string, codes: Iterable<string> }} input
 */
export const buildTaskStatements = ({ statements, ratings, codes }) => {
  const wanted = new Set(codes);
  const tasks = parseTsv(statements, STATEMENT_COLUMNS).filter((r) =>
    wanted.has(r["O*NET-SOC Code"])
  );

  /** @type {Map<string, { im: number | null, ft: Array<[number, number]> }>} */
  const byTask = new Map();
  for (const r of parseTsv(ratings, RATING_COLUMNS)) {
    if (!wanted.has(r["O*NET-SOC Code"])) continue;
    const key = `${r["O*NET-SOC Code"]}|${r["Task ID"]}`;
    const entry = byTask.get(key) ?? { im: null, ft: [] };
    const value = num(r["Data Value"]);
    if (r["Scale ID"] === "IM") entry.im = value;
    if (r["Scale ID"] === "FT" && value !== null && num(r.Category) !== null) {
      entry.ft.push([num(r.Category), value]);
    }
    byTask.set(key, entry);
  }

  const rows = tasks.map((r) => {
    const code = r["O*NET-SOC Code"];
    const rating = byTask.get(`${code}|${r["Task ID"]}`);
    const ftTotal = rating?.ft.reduce((a, [, pct]) => a + pct, 0) ?? 0;
    const frequency =
      ftTotal > 0 ? rating.ft.reduce((a, [cat, pct]) => a + cat * pct, 0) / ftTotal : null;
    const taskType = r["Task Type"];
    return {
      task_id: Number(r["Task ID"]),
      onetsoc_code: code,
      task_text: r.Task,
      task_type: taskType && taskType.toLowerCase() !== "n/a" ? taskType : null,
      importance: rating?.im ?? null,
      frequency,
      source: "onet",
    };
  });

  // Fill missing ratings with the occupation mean.
  for (const code of wanted) {
    const occ = rows.filter((t) => t.onetsoc_code === code);
    const imMean = mean(occ.map((t) => t.importance).filter((v) => v !== null));
    const ftMean = mean(occ.map((t) => t.frequency).filter((v) => v !== null));
    for (const t of occ) {
      t.importance ??= imMean;
      t.frequency ??= ftMean;
    }
  }

  for (const t of rows) {
    if (!Number.isSafeInteger(t.task_id)) throw new Error(`bad O*NET Task ID for ${t.onetsoc_code}`);
    t.importance = round2(t.importance);
    t.frequency = round2(t.frequency);
  }
  return rows;
};
