import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "../src/lib/db";
import { mintToken } from "../src/lib/tokens";
import { upsertApplication } from "../src/lib/applications";
import {
  toolAddNote,
  toolGetApplication,
  toolListApplications,
  toolListNeedsDeisy,
  toolMarkDone,
} from "../src/lib/mcp-tools";

const tmpFiles: string[] = [];

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
  process.env.INGEST_TOKEN = "ingest-env";
  process.env.READ_TOKEN = "read-env";
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
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
});

function tmpDb() {
  const file = path.join(
    os.tmpdir(),
    `deisy-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  tmpFiles.push(file);
  process.env.DATABASE_URL = `file:${file}`;
  resetDb();
}

function parseText(result: { content: Array<{ type: string; text?: string }> }) {
  const block = result.content.find((c) => c.type === "text");
  return JSON.parse(String(block?.text ?? "{}"));
}

describe("MCP tool handlers", () => {
  it("lists, gets, notes, and done with scopes", async () => {
    tmpDb();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "11",
      company: "Hexion",
      role: "Planner",
      status: "Needs-Deisy",
    });
    await upsertApplication(db, {
      id: "12",
      company: "Other",
      role: "Ops",
      status: "Submitted",
    });

    const bot = {
      scopes: ["read", "notes"] as const,
      author: "deisy-bot",
      actor: "deisy-bot",
      token_id: "tok-1",
    };
    const listed = parseText(
      await toolListApplications(db, bot, { company: "Hex" })
    );
    expect(listed.count).toBe(1);
    expect(listed.applications[0].id).toBe("11");

    const needs = parseText(await toolListNeedsDeisy(db, bot));
    expect(needs.count).toBe(1);

    const note = parseText(
      await toolAddNote(db, bot, { id: "11", body: "Revisar CV ES" })
    );
    expect(note.note.author).toBe("deisy-bot");

    const got = parseText(await toolGetApplication(db, bot, { id: "11" }));
    expect(got.notes).toHaveLength(1);

    const done = parseText(await toolMarkDone(db, bot, { id: "11" }));
    expect(done.application.done_at).toBeTruthy();

    const readOnly = {
      scopes: ["read"] as const,
      author: "reader",
      actor: "reader",
      token_id: null,
    };
    const denied = await toolAddNote(db, readOnly, {
      id: "11",
      body: "nope",
    });
    expect("isError" in denied && denied.isError).toBe(true);
  });

  it("MCP HTTP route accepts bearer and rejects missing auth", async () => {
    tmpDb();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "21",
      company: "Co",
      role: "Role",
      status: "Needs-Deisy",
    });
    const { plaintext } = await mintToken(db, {
      name: "deisy-bot",
      scopes: ["read", "notes"],
    });

    const { POST } = await import("../src/app/mcp/route");

    const unauth = await POST(
      new NextRequest("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      })
    );
    expect(unauth.status).toBe(401);

    const init = await POST(
      new NextRequest("http://localhost/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${plaintext}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      })
    );
    expect(init.status).toBe(200);
    const initJson = await init.json();
    expect(initJson.result?.serverInfo?.name).toBe("deisy-jobs");

    const tools = await POST(
      new NextRequest("http://localhost/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${plaintext}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      })
    );
    expect(tools.status).toBe(200);
    const toolsJson = await tools.json();
    const names = (toolsJson.result?.tools ?? []).map(
      (t: { name: string }) => t.name
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "list_applications",
        "get_application",
        "list_needs_deisy",
        "mark_done",
        "add_note",
        "list_resumes",
        "get_resume",
        "upsert_application",
        "update_status",
        "upload_resume",
        "list_changes",
        "next_tasks",
        "list_tasks",
        "create_task",
        "update_task",
        "complete_task",
        "snooze_task",
        "drop_task",
      ])
    );

    const call = await POST(
      new NextRequest("http://localhost/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${plaintext}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "list_needs_deisy",
            arguments: {},
          },
        }),
      })
    );
    expect(call.status).toBe(200);
    const callJson = await call.json();
    const text = callJson.result?.content?.[0]?.text;
    const payload = JSON.parse(text);
    expect(payload.count).toBe(1);
    expect(payload.applications[0].id).toBe("21");
  });
});
