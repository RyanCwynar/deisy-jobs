import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";
import { ensureSchema } from "./db";
import { resolvePublicOrigin, type OriginRequestLike } from "./public-origin";

export type ResumeLang = "en" | "es";

export type ResumeRow = {
  id: string;
  lang: ResumeLang;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  storage_path: string;
  created_at: string;
};

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const RESUME_URL_TTL_SEC = 15 * 60;

function nowIso(): string {
  return new Date().toISOString();
}

export function resumesDir(): string {
  const raw = process.env.RESUMES_DIR?.trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(process.cwd(), "data", "resumes");
}

function resumeUrlSecret(): string {
  const dedicated = process.env.RESUME_URL_SECRET?.trim();
  if (dedicated) return dedicated;
  const session = process.env.SESSION_SECRET?.trim();
  if (session && session.length >= 16) return session;
  throw new Error("RESUME_URL_SECRET or SESSION_SECRET must be set");
}

export function parseResumeLang(raw: string | null | undefined): ResumeLang | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "en" || v === "es") return v;
  return null;
}

function rowFromDb(row: Record<string, unknown>): ResumeRow {
  return {
    id: String(row.id),
    lang: row.lang as ResumeLang,
    filename: String(row.filename),
    content_type: String(row.content_type),
    size: Number(row.size),
    sha256: String(row.sha256),
    storage_path: String(row.storage_path),
    created_at: String(row.created_at),
  };
}

export function isPdfBuffer(buf: Buffer, contentType?: string | null): boolean {
  if (buf.length < 5) return false;
  const magic = buf.subarray(0, 5).toString("utf8");
  if (magic !== "%PDF-") return false;
  if (contentType) {
    const ct = contentType.toLowerCase().split(";")[0]?.trim();
    if (ct && ct !== "application/pdf" && ct !== "application/x-pdf") {
      return false;
    }
  }
  return true;
}

export async function storeResume(
  db: Client,
  opts: {
    lang: ResumeLang;
    filename: string;
    contentType?: string | null;
    data: Buffer;
  }
): Promise<ResumeRow> {
  await ensureSchema(db);
  if (opts.data.length === 0) throw new Error("Empty file");
  if (opts.data.length > MAX_RESUME_BYTES) {
    throw new Error(`PDF exceeds ${MAX_RESUME_BYTES} bytes`);
  }
  if (!isPdfBuffer(opts.data, opts.contentType ?? "application/pdf")) {
    throw new Error("Only PDF files are accepted");
  }

  const id = randomUUID();
  const created_at = nowIso();
  const sha256 = createHash("sha256").update(opts.data).digest("hex");
  const safeName = path
    .basename(opts.filename || `resume-${opts.lang}.pdf`)
    .replace(/[^\w.\-()+ ]+/g, "_");
  const filename = safeName.toLowerCase().endsWith(".pdf")
    ? safeName
    : `${safeName}.pdf`;

  const dir = resumesDir();
  fs.mkdirSync(dir, { recursive: true });
  const storage_path = path.join(opts.lang, `${created_at.replace(/[:.]/g, "-")}_${id}.pdf`);
  const abs = path.join(dir, storage_path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, opts.data);

  await db.execute({
    sql: `
      INSERT INTO resumes (
        id, lang, filename, content_type, size, sha256, storage_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      opts.lang,
      filename,
      "application/pdf",
      opts.data.length,
      sha256,
      storage_path,
      created_at,
    ],
  });

  return {
    id,
    lang: opts.lang,
    filename,
    content_type: "application/pdf",
    size: opts.data.length,
    sha256,
    storage_path,
    created_at,
  };
}

export async function listResumes(db: Client): Promise<ResumeRow[]> {
  await ensureSchema(db);
  const result = await db.execute(
    `SELECT * FROM resumes ORDER BY created_at DESC, id DESC`
  );
  return result.rows.map((r) => rowFromDb(r as Record<string, unknown>));
}

/** Latest resume per language (current). */
export async function listCurrentResumes(db: Client): Promise<ResumeRow[]> {
  const all = await listResumes(db);
  const seen = new Set<ResumeLang>();
  const out: ResumeRow[] = [];
  for (const row of all) {
    if (seen.has(row.lang)) continue;
    seen.add(row.lang);
    out.push(row);
  }
  return out.sort((a, b) => a.lang.localeCompare(b.lang));
}

export async function getLatestResume(
  db: Client,
  lang: ResumeLang
): Promise<ResumeRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM resumes WHERE lang = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    args: [lang],
  });
  if (!result.rows[0]) return null;
  return rowFromDb(result.rows[0] as Record<string, unknown>);
}

export function readResumeBytes(row: ResumeRow): Buffer {
  const abs = path.join(resumesDir(), row.storage_path);
  return fs.readFileSync(abs);
}

export function appBaseUrl(req?: OriginRequestLike | null): string {
  return resolvePublicOrigin(req);
}

function signPayload(lang: ResumeLang, exp: number): string {
  return createHmac("sha256", resumeUrlSecret())
    .update(`${lang}:${exp}`)
    .digest("base64url");
}

export function createSignedResumeUrl(
  lang: ResumeLang,
  opts?: { ttlSec?: number; baseUrl?: string }
): { signed_url: string; expires_at: string; exp: number; sig: string } {
  const ttl = opts?.ttlSec ?? RESUME_URL_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = signPayload(lang, exp);
  const base = opts?.baseUrl ?? appBaseUrl();
  const signed_url = `${base}/api/resumes/${lang}/download?exp=${exp}&sig=${encodeURIComponent(sig)}`;
  return {
    signed_url,
    expires_at: new Date(exp * 1000).toISOString(),
    exp,
    sig,
  };
}

export function verifySignedResumeUrl(
  lang: ResumeLang,
  expRaw: string | null,
  sigRaw: string | null
): { ok: true } | { ok: false; error: string } {
  if (!expRaw || !sigRaw) return { ok: false, error: "Missing sig or exp" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, error: "Invalid exp" };
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return { ok: false, error: "URL expired" };
  // Reject absurdly long-lived forged links even if clock skewed
  if (exp > now + RESUME_URL_TTL_SEC + 60) {
    return { ok: false, error: "Invalid exp" };
  }
  const expected = signPayload(lang, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sigRaw);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Invalid signature" };
  }
  return { ok: true };
}

export function resumePublicMeta(row: ResumeRow) {
  return {
    id: row.id,
    lang: row.lang,
    filename: row.filename,
    content_type: row.content_type,
    size: row.size,
    sha256: row.sha256,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}
