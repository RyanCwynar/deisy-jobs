import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { ensureSchema, resetDb } from "../src/lib/db";
import { requireScopes } from "../src/lib/auth";
import {
  mintToken,
  resolveBearerToken,
  revokeToken,
} from "../src/lib/tokens";
import { upsertApplication } from "../src/lib/applications";

const tmpFiles: string[] = [];
const INGEST = "ingest-env-token";
const READ = "read-env-token";

beforeEach(() => {
  process.env.INGEST_TOKEN = INGEST;
  process.env.READ_TOKEN = READ;
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
});

afterEach(() => {
  resetDb();
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
  delete process.env.SESSION_SECRET;
  delete process.env.DATABASE_URL;
});

function tmpDbUrl() {
  const file = path.join(
    os.tmpdir(),
    `deisy-tokens-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  tmpFiles.push(file);
  process.env.DATABASE_URL = `file:${file}`;
  resetDb();
  return file;
}

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe("api token scopes + revocation", () => {
  it("mints hashed tokens and resolves scopes", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    const { token, plaintext } = await mintToken(db, {
      name: "deisy-bot",
      scopes: ["read", "notes"],
    });
    expect(token.token_hash).toHaveLength(64);
    expect(plaintext.startsWith("dj_")).toBe(true);

    const resolved = await resolveBearerToken(db, plaintext);
    expect(resolved).toMatchObject({
      kind: "token",
      name: "deisy-bot",
      scopes: ["read", "notes"],
      author: "deisy-bot",
    });
  });

  it("rejects revoked tokens", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    const { token, plaintext } = await mintToken(db, {
      name: "deisy-bot",
      scopes: "read,notes",
    });
    await revokeToken(db, token.id);
    expect(await resolveBearerToken(db, plaintext)).toBeNull();
  });

  it("keeps env INGEST/READ tokens working", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    const ingest = await resolveBearerToken(db, INGEST);
    expect(ingest?.scopes).toContain("ingest");
    expect(ingest?.scopes).toContain("read");
    const read = await resolveBearerToken(db, READ);
    expect(read?.scopes).toEqual(["read", "notes"]);
    expect(read?.scopes).not.toContain("ingest");
  });

  it("scoped bot tokens without ingest cannot upsert (403)", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    const { plaintext } = await mintToken(db, {
      name: "deisy-bot",
      scopes: ["read", "notes"],
    });

    const { POST } = await import("../src/app/api/applications/upsert/route");
    const res = await POST(
      req("http://localhost/api/applications/upsert", {
        authorization: `Bearer ${plaintext}`,
        "content-type": "application/json",
      })
    );
    // Body not required — scope check runs first; without ingest → 403
    // Actually requireScopes runs before body parse, so 403
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/ingest/i);
  });

  it("read-only token cannot add notes", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    await upsertApplication(db, {
      id: "01",
      company: "Acme",
      role: "Ops",
      status: "Needs-Deisy",
    });
    const { plaintext } = await mintToken(db, {
      name: "reader",
      scopes: ["read"],
    });

    const access = await requireScopes(
      req("http://localhost/api/applications/01/notes", {
        authorization: `Bearer ${plaintext}`,
      }),
      ["notes"]
    );
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.status).toBe(403);
  });

  it("notes-scoped token can mark done and add note as token name", async () => {
    tmpDbUrl();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    await upsertApplication(db, {
      id: "02",
      company: "Beta",
      role: "Analyst",
      status: "Needs-Deisy",
    });
    const { plaintext } = await mintToken(db, {
      name: "deisy-bot",
      scopes: ["read", "notes"],
    });

    const { POST: postNote } = await import(
      "../src/app/api/applications/[id]/notes/route"
    );
    const noteRes = await postNote(
      new NextRequest("http://localhost/api/applications/02/notes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${plaintext}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Checking this one" }),
      }),
      { params: Promise.resolve({ id: "02" }) }
    );
    expect(noteRes.status).toBe(200);
    const noteJson = await noteRes.json();
    expect(noteJson.note.author).toBe("deisy-bot");

    const { POST: postDone } = await import(
      "../src/app/api/applications/[id]/done/route"
    );
    const doneRes = await postDone(
      new NextRequest("http://localhost/api/applications/02/done", {
        method: "POST",
        headers: {
          authorization: `Bearer ${plaintext}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ done: true }),
      }),
      { params: Promise.resolve({ id: "02" }) }
    );
    expect(doneRes.status).toBe(200);
  });

  it("migrates notes CHECK so custom authors are allowed", async () => {
    const file = path.join(
      os.tmpdir(),
      `deisy-migrate-${Date.now()}.db`
    );
    tmpFiles.push(file);
    const raw = createClient({ url: `file:${file}` });
    await raw.execute(`
      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        date_found TEXT,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        location TEXT,
        listed_pay TEXT,
        cv TEXT,
        apply_link TEXT,
        status TEXT NOT NULL,
        status_reason TEXT,
        raw_status TEXT,
        date_applied TEXT,
        notes TEXT,
        done_at TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await raw.execute(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT NOT NULL,
        author TEXT NOT NULL CHECK (author IN ('deisy', 'ryan', 'bot')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await raw.execute({
      sql: `INSERT INTO applications (id, company, role, status, updated_at, created_at)
            VALUES ('01', 'X', 'Y', 'Found', 't', 't')`,
      args: [],
    });
    await raw.execute({
      sql: `INSERT INTO notes (application_id, author, body, created_at)
            VALUES ('01', 'bot', 'old', 't')`,
      args: [],
    });
    raw.close();

    process.env.DATABASE_URL = `file:${file}`;
    resetDb();
    const { ensureSchema: es, getDb } = await import("../src/lib/db");
    const db = await es(getDb());
    await db.execute({
      sql: `INSERT INTO notes (application_id, author, body, created_at)
            VALUES ('01', 'deisy-bot', 'new author ok', 't2')`,
      args: [],
    });
    const r = await db.execute(`SELECT author FROM notes ORDER BY id`);
    expect(r.rows.map((row) => String(row.author))).toEqual([
      "bot",
      "deisy-bot",
    ]);
  });
});
