#!/usr/bin/env tsx
/**
 * Idempotent CSV → applications import.
 * Usage: DATABASE_URL=file:./data/deisy-jobs.db npx tsx scripts/import.ts [path/to.csv]
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { createClient } from "@libsql/client";
import { ensureSchema } from "../src/lib/db";
import { upsertApplication, normalizeId } from "../src/lib/applications";
import { normalizeCv, normalizeStatus } from "../src/lib/status";

export type CsvRow = {
  "#": string;
  "Date found": string;
  Company: string;
  Role: string;
  "Location / remote": string;
  "Listed pay": string;
  CV: string;
  "Apply link": string;
  Status: string;
  "Date applied": string;
  Notes: string;
};

export function parseCsv(content: string): CsvRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];
}

export function csvRowToInput(row: CsvRow) {
  const raw = row.Status ?? "";
  const parsed = normalizeStatus(raw);
  return {
    id: normalizeId(row["#"]),
    date_found: row["Date found"] || null,
    company: row.Company || "",
    role: row.Role || "",
    location: row["Location / remote"] || null,
    listed_pay: row["Listed pay"] || null,
    cv: normalizeCv(row.CV),
    apply_link: row["Apply link"] || null,
    status: parsed.status,
    status_reason: parsed.status_reason,
    raw_status: parsed.raw_status,
    date_applied: row["Date applied"] || null,
    notes: row.Notes || null,
  };
}

export async function importCsv(
  csvPath: string,
  databaseUrl: string
): Promise<{ created: number; updated: number; total: number }> {
  const content = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(content);
  const db = createClient({ url: databaseUrl });
  await ensureSchema(db);

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (!row["#"] || !row.Company) continue;
    const result = await upsertApplication(db, csvRowToInput(row));
    if (result.created) created += 1;
    else updated += 1;
  }
  db.close();
  return { created, updated, total: created + updated };
}

async function main() {
  const csvPath =
    process.argv[2] ??
    path.join(process.cwd(), "data", "deisy-tracker.csv");
  const databaseUrl =
    process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "deisy-jobs.db")}`;

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`Importing ${csvPath} → ${databaseUrl}`);
  const result = await importCsv(csvPath, databaseUrl);
  console.log(
    `Done: ${result.total} rows (${result.created} created, ${result.updated} updated)`
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("scripts/import.ts") ||
    process.argv[1].endsWith("scripts/import.js"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
