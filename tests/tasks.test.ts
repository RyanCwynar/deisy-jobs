import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "../src/lib/db";
import { upsertApplication } from "../src/lib/applications";
import {
  extractAsk,
  groupNeedsDeisyIntoTasks,
  normalizeAskKey,
  seedTasksFromNeedsDeisy,
} from "../src/lib/task-seed";
import {
  createTask,
  nextTasks,
  payScore,
  snoozeTask,
} from "../src/lib/tasks";
import { listChanges } from "../src/lib/changelog";
import { mintToken } from "../src/lib/tokens";
import {
  toolCreateTask,
  toolNextTasks,
  toolCompleteTask,
} from "../src/lib/mcp-tools";

const tmpPaths: string[] = [];

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
  process.env.INGEST_TOKEN = "ingest-env-token";
  process.env.READ_TOKEN = "read-env-token";
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
  delete process.env.SESSION_SECRET;
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
});

function tmpEnv() {
  const root = path.join(
    os.tmpdir(),
    `deisy-tasks-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(root, { recursive: true });
  tmpPaths.push(root);
  process.env.DATABASE_URL = `file:${path.join(root, "db.sqlite")}`;
  resetDb();
}

function parseText(result: { content: Array<{ type: string; text?: string }> }) {
  const block = result.content.find((c) => c.type === "text");
  return JSON.parse(String(block?.text ?? "{}"));
}

describe("task model helpers", () => {
  it("payScore ranks monthly USD above missing pay", () => {
    expect(payScore("$5,000–$6,000 USD/mo")).toBeGreaterThan(payScore(null));
    expect(payScore("$5,000–$6,000 USD/mo")).toBeGreaterThan(
      payScore("Not listed")
    );
  });

  it("normalizeAskKey dedupes identical BairesDev Cloudflare asks", () => {
    const a = normalizeAskKey(
      "Cloudflare human check on applicants.bairesdev.com"
    );
    const b = normalizeAskKey(
      "LinkedIn external apply (not Easy Apply) → applicants.bairesdev.com CF check"
    );
    expect(a).toBe(b);
    expect(a).toBe("ask:bairesdev-cloudflare");
  });
});

describe("seed dedupe", () => {
  it("groups identical asks into one task linked to multiple apps", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "23",
      company: "BairesDev",
      role: "Power BI",
      status: "Needs Deisy: Cloudflare human check on applicants.bairesdev.com",
      listed_pay: "$75k–$100k",
    });
    await upsertApplication(db, {
      id: "24",
      company: "BairesDev",
      role: "Analista",
      status: "Needs Deisy: Cloudflare human check on applicants.bairesdev.com",
      listed_pay: "Not listed",
    });
    await upsertApplication(db, {
      id: "11",
      company: "CBRE",
      role: "Facilities",
      status: "Needs Deisy: CBRE careers account",
    });

    const first = await seedTasksFromNeedsDeisy(db);
    expect(first.created).toBe(2);
    expect(first.groups).toBe(2);

    const second = await seedTasksFromNeedsDeisy(db);
    expect(second.created).toBe(0);
    expect(second.unchanged + second.updated).toBe(2);

    const next = await nextTasks(db, 10);
    const cf = next.find((t) => t.seed_key === "ask:bairesdev-cloudflare");
    expect(cf).toBeTruthy();
    expect(cf!.application_ids.sort()).toEqual(["23", "24"]);
    expect(cf!.linked_count).toBe(2);
  });

  it("extractAsk and groupNeedsDeisyIntoTasks are pure", () => {
    const groups = groupNeedsDeisyIntoTasks([
      {
        id: "195",
        date_found: null,
        company: "Scale Army",
        role: "Admin",
        location: null,
        listed_pay: null,
        cv: "EN",
        apply_link: null,
        status: "Needs-Deisy",
        status_reason: "video required",
        raw_status: "Needs-Deisy (video required)",
        date_applied: null,
        notes: null,
        done_at: null,
        updated_at: "t",
        created_at: "t",
      },
      {
        id: "196",
        date_found: null,
        company: "Scale Army",
        role: "Creative Ops",
        location: null,
        listed_pay: null,
        cv: "EN",
        apply_link: null,
        status: "Needs-Deisy",
        status_reason: "video required",
        raw_status: "Needs-Deisy (video required)",
        date_applied: null,
        notes: null,
        done_at: null,
        updated_at: "t",
        created_at: "t",
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.application_ids).toEqual(["195", "196"]);
    expect(extractAsk(groups[0]!.apps[0]!)).toMatch(/video/i);
  });
});

describe("next_tasks ordering", () => {
  it("orders by linked count then pay then priority", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "01",
      company: "LowPay",
      role: "A",
      status: "Needs-Deisy",
      listed_pay: "$1,000/mo",
    });
    await upsertApplication(db, {
      id: "02",
      company: "HighPay",
      role: "B",
      status: "Needs-Deisy",
      listed_pay: "$6,000/mo",
    });
    await upsertApplication(db, {
      id: "03",
      company: "AlsoHigh",
      role: "C",
      status: "Needs-Deisy",
      listed_pay: "$5,500/mo",
    });

    await createTask(db, {
      title: "Single low",
      detail: "one",
      kind: "other",
      application_ids: ["01"],
      priority: 99,
      created_by: "test",
    });
    await createTask(db, {
      title: "Two apps high pay",
      detail: "two",
      kind: "account",
      application_ids: ["02", "03"],
      priority: 1,
      created_by: "test",
    });

    const ordered = await nextTasks(db, 10);
    expect(ordered[0]!.title).toBe("Two apps high pay");
    expect(ordered[0]!.linked_count).toBe(2);
    expect(ordered[1]!.title).toBe("Single low");
  });

  it("includes snoozed tasks whose until has passed", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "10",
      company: "Co",
      role: "R",
      status: "Needs-Deisy",
    });
    const task = await createTask(db, {
      title: "Was snoozed",
      kind: "answer",
      application_ids: ["10"],
      created_by: "test",
    });
    await snoozeTask(db, task.id, {
      until: new Date(Date.now() - 60_000).toISOString(),
    });
    const next = await nextTasks(db, 5);
    expect(next.some((t) => t.id === task.id)).toBe(true);
  });
});

describe("task MCP/REST auth", () => {
  it("create_task requires write; next_tasks requires read", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "50",
      company: "X",
      role: "Y",
      status: "Needs-Deisy",
    });

    const reader = {
      scopes: ["read"] as const,
      author: "reader",
      actor: "reader",
      token_id: null,
    };
    const denied = await toolCreateTask(db, reader, {
      title: "Nope",
      kind: "other",
      application_ids: ["50"],
    });
    expect("isError" in denied && denied.isError).toBe(true);

    const writer = {
      scopes: ["write", "read"] as const,
      author: "deisy-bot",
      actor: "deisy-bot",
      token_id: "tok",
    };
    const created = parseText(
      await toolCreateTask(db, writer, {
        title: "Finish captcha",
        detail: "Solve it in Chrome",
        kind: "answer",
        application_ids: ["50"],
        priority: 2,
      })
    );
    expect(created.ok).toBe(true);
    expect(created.task.kind).toBe("answer");

    const next = parseText(await toolNextTasks(db, reader, { limit: 5 }));
    expect(next.count).toBeGreaterThanOrEqual(1);

    await toolCompleteTask(db, writer, {
      id: created.task.id,
      note: "Done in browser",
    });
    const changes = await listChanges(db, { actor: "deisy-bot" });
    expect(changes.some((c) => c.entity === "task")).toBe(true);
  });

  it("REST GET /api/tasks/next and POST create use scopes", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await upsertApplication(db, {
      id: "60",
      company: "Z",
      role: "Ops",
      status: "Needs-Deisy",
    });
    const { plaintext: readTok } = await mintToken(db, {
      name: "reader",
      scopes: ["read"],
    });
    const { plaintext: writeTok } = await mintToken(db, {
      name: "writer",
      scopes: ["write", "read"],
    });

    const { POST } = await import("../src/app/api/tasks/route");
    const forbidden = await POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${readTok}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "x",
          kind: "other",
          application_ids: ["60"],
        }),
      })
    );
    expect(forbidden.status).toBe(403);

    const created = await POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${writeTok}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Upload speed screenshot",
          detail: "Use fast.com screenshot",
          kind: "upload",
          application_ids: ["60"],
        }),
      })
    );
    expect(created.status).toBe(200);

    const { GET } = await import("../src/app/api/tasks/next/route");
    const next = await GET(
      new NextRequest("http://localhost/api/tasks/next", {
        headers: { authorization: `Bearer ${readTok}` },
      })
    );
    expect(next.status).toBe(200);
    const json = await next.json();
    expect(json.count).toBeGreaterThanOrEqual(1);
  });
});
