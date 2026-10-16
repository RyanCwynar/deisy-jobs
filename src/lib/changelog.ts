import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { AccessPrincipal } from "./auth";
import { ensureSchema } from "./db";

export type ChangeAction = "create" | "update";

export type ChangeLogRow = {
  id: string;
  at: string;
  actor: string;
  token_id: string | null;
  entity: string;
  entity_id: string;
  action: ChangeAction;
  diff: Record<string, unknown>;
};

export type AuditActor = {
  actor: string;
  token_id: string | null;
};

export function actorFromPrincipal(principal: AccessPrincipal): AuditActor {
  if (principal.kind === "session") {
    return { actor: principal.user.email, token_id: null };
  }
  if (principal.kind === "env") {
    if (principal.name === "INGEST_TOKEN") {
      return { actor: "ingest", token_id: null };
    }
    return { actor: "read", token_id: null };
  }
  return { actor: principal.name, token_id: principal.id };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after),
  ]);
  for (const key of keys) {
    const from = before ? before[key] : null;
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      out[key] = { from, to };
    }
  }
  return out;
}

export async function recordChange(
  db: Client,
  opts: {
    actor: string;
    token_id?: string | null;
    entity: string;
    entity_id: string;
    action: ChangeAction;
    diff: Record<string, unknown>;
  }
): Promise<ChangeLogRow> {
  await ensureSchema(db);
  const id = randomUUID();
  const at = nowIso();
  const diffJson = JSON.stringify(opts.diff ?? {});
  await db.execute({
    sql: `
      INSERT INTO change_log (id, at, actor, token_id, entity, entity_id, action, diff)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      at,
      opts.actor,
      opts.token_id ?? null,
      opts.entity,
      opts.entity_id,
      opts.action,
      diffJson,
    ],
  });
  return {
    id,
    at,
    actor: opts.actor,
    token_id: opts.token_id ?? null,
    entity: opts.entity,
    entity_id: opts.entity_id,
    action: opts.action,
    diff: opts.diff,
  };
}

export type ListChangesFilters = {
  since?: string;
  actor?: string;
  limit?: number;
};

export async function listChanges(
  db: Client,
  filters: ListChangesFilters = {}
): Promise<ChangeLogRow[]> {
  await ensureSchema(db);
  const where: string[] = [];
  const args: (string | number | null)[] = [];
  if (filters.since) {
    where.push(`at >= ?`);
    args.push(filters.since);
  }
  if (filters.actor) {
    where.push(`actor = ?`);
    args.push(filters.actor);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const sql = `
    SELECT * FROM change_log
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY at DESC, id DESC
    LIMIT ?
  `;
  args.push(limit);
  const result = await db.execute({ sql, args });
  return result.rows.map((r) => {
    let diff: Record<string, unknown> = {};
    try {
      diff = JSON.parse(String(r.diff ?? "{}")) as Record<string, unknown>;
    } catch {
      diff = {};
    }
    return {
      id: String(r.id),
      at: String(r.at),
      actor: String(r.actor),
      token_id: r.token_id == null ? null : String(r.token_id),
      entity: String(r.entity),
      entity_id: String(r.entity_id),
      action: r.action as ChangeAction,
      diff,
    };
  });
}
