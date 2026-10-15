import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { csvRowToInput, importCsv, parseCsv } from "../scripts/import";
import { ensureSchema } from "../src/lib/db";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

function tmpDb(): string {
  const file = path.join(
    os.tmpdir(),
    `deisy-import-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  tmpFiles.push(file);
  return `file:${file}`;
}

describe("import", () => {
  it("parses CSV rows and normalizes status", () => {
    const sample = `#,Date found,Company,Role,Location / remote,Listed pay,CV,Apply link,Status,Date applied,Notes
01,2026-09-24,Hexion,Planner,Remote,Not listed,EN,https://example.com,Skipped (not eligible),,note
11,2026-09-24,CBRE,Coord,Medellín,,ES,https://example.com,Needs Deisy: account,,note2
`;
    const rows = parseCsv(sample);
    expect(rows).toHaveLength(2);
    const a = csvRowToInput(rows[0]);
    expect(a.id).toBe("01");
    expect(a.status).toBe("Skipped");
    expect(a.status_reason).toBe("not eligible");
    const b = csvRowToInput(rows[1]);
    expect(b.status).toBe("Needs-Deisy");
    expect(b.cv).toBe("ES");
  });

  it("is idempotent when run twice", async () => {
    const csvPath = path.join(process.cwd(), "data", "deisy-tracker.csv");
    expect(fs.existsSync(csvPath)).toBe(true);
    const url = tmpDb();

    const first = await importCsv(csvPath, url);
    expect(first.created).toBe(613);
    expect(first.updated).toBe(0);

    const second = await importCsv(csvPath, url);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(613);

    const db = createClient({ url });
    await ensureSchema(db);
    const count = await db.execute(`SELECT COUNT(*) AS c FROM applications`);
    expect(Number(count.rows[0].c)).toBe(613);

    const needs = await db.execute(
      `SELECT COUNT(*) AS c FROM applications WHERE status = 'Needs-Deisy'`
    );
    expect(Number(needs.rows[0].c)).toBeGreaterThan(40);
    db.close();
  }, 60000);
});
