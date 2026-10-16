import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "../src/lib/db";
import { listChanges } from "../src/lib/changelog";
import { getApplication } from "../src/lib/applications";
import { getLatestResume } from "../src/lib/resumes";
import { mintToken, setTokenScopes } from "../src/lib/tokens";
import {
  toolListChanges,
  toolUpdateStatus,
  toolUploadResume,
  toolUpsertApplication,
} from "../src/lib/mcp-tools";

const tmpPaths: string[] = [];

function minimalPdf(label: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${label}\n`,
    "binary"
  );
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
  process.env.INGEST_TOKEN = "ingest-env-token";
  process.env.READ_TOKEN = "read-env-token";
  process.env.APP_URL = "https://deisy.byldr.co";
});

afterEach(() => {
  resetDb();
  for (const p of tmpPaths.splice(0)) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  delete process.env.DATABASE_URL;
  delete process.env.RESUMES_DIR;
  delete process.env.SESSION_SECRET;
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
  delete process.env.APP_URL;
});

function tmpEnv() {
  const root = path.join(
    os.tmpdir(),
    `deisy-write-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(root, { recursive: true });
  tmpPaths.push(root);
  process.env.DATABASE_URL = `file:${path.join(root, "db.sqlite")}`;
  process.env.RESUMES_DIR = path.join(root, "resumes");
  resetDb();
}

function parseText(result: { content: Array<{ type: string; text?: string }> }) {
  const block = result.content.find((c) => c.type === "text");
  return JSON.parse(String(block?.text ?? "{}"));
}

describe("token:scopes / write scope", () => {
  it("setTokenScopes grants write", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const { token } = await mintToken(db, {
      name: "deisy-bot",
      scopes: ["read", "notes"],
    });
    const updated = await setTokenScopes(db, token.id, "read,notes,write");
    expect(updated?.scopes).toEqual(["read", "notes", "write"]);
  });
});

describe("MCP write tools", () => {
  it("upsert_application creates with auto id and patches fields", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const writer = {
      scopes: ["write"] as const,
      author: "deisy-bot",
      actor: "deisy-bot",
      token_id: "<REDACTED_TOKEN>",
    };

    const created = parseText(
      await toolUpsertApplication(db, writer, {
        company: "Acme",
        role: "Ops Analyst",
        status: "Found",
      })
    );
    expect(created.created).toBe(true);
    expect(created.application.id).toBeTruthy();
    const id = created.application.id as string;

    const patched = parseText(
      await toolUpsertApplication(db, writer, {
        id,
        status: "Submitted",
        date_applied: "2026-10-16",
      })
    );
    expect(patched.created).toBe(false);
    expect(patched.application.company).toBe("Acme");
    expect(patched.application.status).toBe("Submitted");
    expect(patched.application.date_applied).toBe("2026-10-16");

    const denied = await toolUpsertApplication(
      db,
      { scopes: ["read"], author: "x", actor: "x", token_id: null },
      { company: "Nope", role: "Nope" }
    );
    expect("isError" in denied && denied.isError).toBe(true);

    const changes = await listChanges(db, { actor: "deisy-bot" });
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.some((c) => c.action === "create")).toBe(true);
    expect(changes.some((c) => c.action === "update")).toBe(true);
  });

  it("update_status and upload_resume require write and audit", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const writer = {
      scopes: ["write", "read"] as const,
      author: "deisy-bot",
      actor: "deisy-bot",
      token_id: "tok-write",
    };
    const created = parseText(
      await toolUpsertApplication(db, writer, {
        company: "Beta",
        role: "Planner",
        status: "Parked",
      })
    );
    const id = created.application.id as string;

    const status = parseText(
      await toolUpdateStatus(db, writer, { id, status: "Closed (filled)" })
    );
    expect(status.application.status).toBe("Closed");

    const missing = await toolUpdateStatus(db, writer, {
      id: "9999",
      status: "Found",
    });
    expect("isError" in missing && missing.isError).toBe(true);

    const pdf = minimalPdf("en-v1");
    const uploaded = parseText(
      await toolUploadResume(db, writer, {
        lang: "en",
        file_base64: pdf.toString("base64"),
        filename: "deisy-en.pdf",
      })
    );
    expect(uploaded.resume.lang).toBe("en");
    const latest = await getLatestResume(db, "en");
    expect(latest?.filename).toBe("deisy-en.pdf");

    const listed = parseText(
      await toolListChanges(db, writer, { actor: "deisy-bot", limit: 50 })
    );
    expect(listed.count).toBeGreaterThanOrEqual(3);
    expect(
      listed.changes.some(
        (c: { entity: string; action: string }) =>
          c.entity === "resume" && c.action === "create"
      )
    ).toBe(true);
  });
});

describe("GET /api/changes + ingest audit actor", () => {
  it("lists changes and records ingest actor on REST upsert", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const { plaintext: readTok } = await mintToken(db, {
      name: "reader",
      scopes: ["read"],
    });

    const { POST } = await import("../src/app/api/applications/upsert/route");
    const res = await POST(
      new NextRequest("http://localhost/api/applications/upsert", {
        method: "POST",
        headers: {
          authorization: "Bearer ingest-env-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          applications: [
            {
              id: "77",
              company: "IngestCo",
              role: "Analyst",
              status: "Submitted",
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const app = await getApplication(db, "77");
    expect(app?.company).toBe("IngestCo");

    const { GET } = await import("../src/app/api/changes/route");
    const listed = await GET(
      new NextRequest("http://localhost/api/changes?actor=ingest", {
        headers: { authorization: `Bearer ${readTok}` },
      })
    );
    expect(listed.status).toBe(200);
    const json = await listed.json();
    expect(json.count).toBeGreaterThanOrEqual(1);
    expect(json.changes[0].actor).toBe("ingest");
    expect(json.changes[0].entity).toBe("application");
  });
});
