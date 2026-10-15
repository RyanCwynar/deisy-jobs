import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { ensureSchema } from "../src/lib/db";
import {
  getApplication,
  markDone,
  upsertApplication,
  upsertMany,
} from "../src/lib/applications";

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

function tmpClient() {
  const file = path.join(
    os.tmpdir(),
    `deisy-upsert-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  tmpFiles.push(file);
  const db = createClient({ url: `file:${file}` });
  return db;
}

describe("upsertApplication", () => {
  it("creates then updates by zero-padded id", async () => {
    const db = tmpClient();
    await ensureSchema(db);

    const created = await upsertApplication(db, {
      id: "7",
      company: "Draft.dev",
      role: "SEO Analyst",
      status: "Submitted (LinkedIn Easy Apply)",
      cv: "EN",
    });
    expect(created.created).toBe(true);
    expect(created.id).toBe("07");

    const updated = await upsertApplication(db, {
      id: "07",
      company: "Draft.dev",
      role: "Senior SEO/AEO Analyst",
      status: "Submitted",
      date_applied: "2026-09-25",
    });
    expect(updated.created).toBe(false);

    const app = await getApplication(db, "07");
    expect(app?.role).toBe("Senior SEO/AEO Analyst");
    expect(app?.status).toBe("Submitted");
    expect(app?.date_applied).toBe("2026-09-25");
    db.close();
  });

  it("batch upsert is idempotent", async () => {
    const db = tmpClient();
    await ensureSchema(db);
    const items = [
      {
        id: "01",
        company: "A",
        role: "R1",
        raw_status: "Parked: wait",
      },
      {
        id: "02",
        company: "B",
        role: "R2",
        raw_status: "Needs Deisy: login",
      },
    ];
    const first = await upsertMany(db, items);
    expect(first.created).toBe(2);
    const second = await upsertMany(db, items);
    expect(second.updated).toBe(2);
    expect(second.created).toBe(0);

    const app = await getApplication(db, "02");
    expect(app?.status).toBe("Needs-Deisy");
    await markDone(db, "02");
    const done = await getApplication(db, "02");
    expect(done?.done_at).toBeTruthy();
    db.close();
  });
});
