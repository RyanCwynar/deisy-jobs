import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { ensureSchema } from "./db";
import {
  parseScopes,
  scopesToString,
  type ApiScope,
} from "./scopes";

export type ApiTokenRow = {
  id: string;
  name: string;
  scopes: ApiScope[];
  token_hash: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

export type ResolvedBearer =
  | {
      kind: "env";
      name: "INGEST_TOKEN" | "READ_TOKEN";
      scopes: ApiScope[];
      author: "bot";
    }
  | {
      kind: "token";
      id: string;
      name: string;
      scopes: ApiScope[];
      author: string;
    };

function nowIso(): string {
  return new Date().toISOString();
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateTokenPlaintext(): string {
  return `dj_${randomBytes(32).toString("base64url")}`;
}

function rowFromDb(row: Record<string, unknown>): ApiTokenRow {
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: parseScopes(String(row.scopes ?? "")),
    token_hash: String(row.token_hash),
    created_at: String(row.created_at),
    revoked_at: (row.revoked_at as string) ?? null,
    last_used_at: (row.last_used_at as string) ?? null,
  };
}

export async function mintToken(
  db: Client,
  opts: { name: string; scopes: ApiScope[] | string }
): Promise<{ token: ApiTokenRow; plaintext: string }> {
  await ensureSchema(db);
  const name = opts.name.trim();
  if (!name) throw new Error("Token name is required");
  const scopes = parseScopes(opts.scopes);
  if (scopes.length === 0) throw new Error("At least one valid scope is required");

  const plaintext = generateTokenPlaintext();
  const id = randomUUID();
  const created_at = nowIso();
  const token_hash = hashToken(plaintext);

  await db.execute({
    sql: `
      INSERT INTO api_tokens (id, name, scopes, token_hash, created_at, revoked_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `,
    args: [id, name, scopesToString(scopes), token_hash, created_at],
  });

  return {
    plaintext,
    token: {
      id,
      name,
      scopes,
      token_hash,
      created_at,
      revoked_at: null,
      last_used_at: null,
    },
  };
}

export async function setTokenScopes(
  db: Client,
  id: string,
  scopesRaw: ApiScope[] | string
): Promise<ApiTokenRow | null> {
  await ensureSchema(db);
  const existing = await getTokenById(db, id);
  if (!existing) return null;
  const scopes = parseScopes(scopesRaw);
  if (scopes.length === 0) throw new Error("At least one valid scope is required");
  await db.execute({
    sql: `UPDATE api_tokens SET scopes = ? WHERE id = ?`,
    args: [scopesToString(scopes), id],
  });
  return { ...existing, scopes };
}

export async function revokeToken(
  db: Client,
  id: string
): Promise<ApiTokenRow | null> {
  await ensureSchema(db);
  const existing = await getTokenById(db, id);
  if (!existing) return null;
  if (existing.revoked_at) return existing;
  const revoked_at = nowIso();
  await db.execute({
    sql: `UPDATE api_tokens SET revoked_at = ? WHERE id = ?`,
    args: [revoked_at, id],
  });
  return { ...existing, revoked_at };
}

export async function revokeTokenByName(
  db: Client,
  name: string
): Promise<ApiTokenRow[]> {
  await ensureSchema(db);
  const list = await listTokens(db);
  const targets = list.filter(
    (t) => t.name === name && !t.revoked_at
  );
  const out: ApiTokenRow[] = [];
  for (const t of targets) {
    const r = await revokeToken(db, t.id);
    if (r) out.push(r);
  }
  return out;
}

export async function getTokenById(
  db: Client,
  id: string
): Promise<ApiTokenRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM api_tokens WHERE id = ?`,
    args: [id],
  });
  if (!result.rows[0]) return null;
  return rowFromDb(result.rows[0] as Record<string, unknown>);
}

export async function listTokens(db: Client): Promise<ApiTokenRow[]> {
  await ensureSchema(db);
  const result = await db.execute(
    `SELECT * FROM api_tokens ORDER BY created_at DESC`
  );
  return result.rows.map((r) => rowFromDb(r as Record<string, unknown>));
}

async function touchLastUsed(db: Client, id: string): Promise<void> {
  await db.execute({
    sql: `UPDATE api_tokens SET last_used_at = ? WHERE id = ?`,
    args: [nowIso(), id],
  });
}

/** Resolve env + DB bearer tokens. Revoked DB tokens return null. */
export async function resolveBearerToken(
  db: Client,
  plaintext: string | null | undefined
): Promise<ResolvedBearer | null> {
  if (!plaintext) return null;

  const ingest = process.env.INGEST_TOKEN;
  if (ingest && plaintext === ingest) {
    return {
      kind: "env",
      name: "INGEST_TOKEN",
      scopes: ["ingest", "read", "notes", "write"],
      author: "bot",
    };
  }

  const read = process.env.READ_TOKEN;
  if (read && plaintext === read) {
    return {
      kind: "env",
      name: "READ_TOKEN",
      scopes: ["read", "notes"],
      author: "bot",
    };
  }

  await ensureSchema(db);
  const token_hash = hashToken(plaintext);
  const result = await db.execute({
    sql: `SELECT * FROM api_tokens WHERE token_hash = ?`,
    args: [token_hash],
  });
  const row = result.rows[0];
  if (!row) return null;
  const token = rowFromDb(row as Record<string, unknown>);
  if (token.revoked_at) return null;

  void touchLastUsed(db, token.id).catch(() => undefined);

  return {
    kind: "token",
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    author: token.name,
  };
}

export function tokenPublicView(token: ApiTokenRow) {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    created_at: token.created_at,
    revoked_at: token.revoked_at,
    last_used_at: token.last_used_at,
  };
}
