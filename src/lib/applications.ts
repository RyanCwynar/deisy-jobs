import type { Client } from "@libsql/client";
import {
  ensureSchema,
  type ApplicationInput,
  type ApplicationRow,
  type NoteRow,
} from "./db";
import { normalizeCv, normalizeStatus } from "./status";

function nowIso(): string {
  return new Date().toISOString();
}

/** Zero-pad application # key (e.g. "1" → "01", "100" → "100"). */
export function normalizeId(raw: string | number): string {
  const s = String(raw).trim();
  if (/^\d+$/.test(s) && s.length < 2) return s.padStart(2, "0");
  return s;
}

export async function upsertApplication(
  db: Client,
  input: ApplicationInput
): Promise<{ id: string; created: boolean }> {
  await ensureSchema(db);
  const id = normalizeId(input.id);
  const parsed =
    input.status !== undefined || input.raw_status !== undefined
      ? normalizeStatus(input.raw_status ?? input.status)
      : null;

  const status = parsed?.status ?? input.status ?? "Found";
  const status_reason =
    input.status_reason !== undefined
      ? input.status_reason
      : (parsed?.status_reason ?? null);
  const raw_status =
    input.raw_status ?? parsed?.raw_status ?? input.status ?? "";
  const cv = normalizeCv(input.cv);
  const updated_at = nowIso();

  const existing = await db.execute({
    sql: `SELECT id FROM applications WHERE id = ?`,
    args: [id],
  });

  if (existing.rows.length > 0) {
    await db.execute({
      sql: `
        UPDATE applications SET
          date_found = COALESCE(?, date_found),
          company = ?,
          role = ?,
          location = COALESCE(?, location),
          listed_pay = COALESCE(?, listed_pay),
          cv = COALESCE(?, cv),
          apply_link = COALESCE(?, apply_link),
          status = ?,
          status_reason = ?,
          raw_status = ?,
          date_applied = COALESCE(?, date_applied),
          notes = COALESCE(?, notes),
          updated_at = ?
        WHERE id = ?
      `,
      args: [
        input.date_found ?? null,
        input.company,
        input.role,
        input.location ?? null,
        input.listed_pay ?? null,
        cv,
        input.apply_link ?? null,
        status,
        status_reason,
        raw_status,
        input.date_applied ?? null,
        input.notes ?? null,
        updated_at,
        id,
      ],
    });
    return { id, created: false };
  }

  await db.execute({
    sql: `
      INSERT INTO applications (
        id, date_found, company, role, location, listed_pay, cv, apply_link,
        status, status_reason, raw_status, date_applied, notes,
        done_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `,
    args: [
      id,
      input.date_found ?? null,
      input.company,
      input.role,
      input.location ?? null,
      input.listed_pay ?? null,
      cv,
      input.apply_link ?? null,
      status,
      status_reason,
      raw_status,
      input.date_applied ?? null,
      input.notes ?? null,
      updated_at,
      updated_at,
    ],
  });
  return { id, created: true };
}

export async function upsertMany(
  db: Client,
  items: ApplicationInput[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const r = await upsertApplication(db, item);
    if (r.created) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

export type ListFilters = {
  status?: string;
  since?: string;
  company?: string;
  cv?: string;
  from?: string;
  to?: string;
};

function rowToApp(row: Record<string, unknown>): ApplicationRow {
  return {
    id: String(row.id),
    date_found: (row.date_found as string) ?? null,
    company: String(row.company),
    role: String(row.role),
    location: (row.location as string) ?? null,
    listed_pay: (row.listed_pay as string) ?? null,
    cv: (row.cv as string) ?? null,
    apply_link: (row.apply_link as string) ?? null,
    status: String(row.status),
    status_reason: (row.status_reason as string) ?? null,
    raw_status: (row.raw_status as string) ?? null,
    date_applied: (row.date_applied as string) ?? null,
    notes: (row.notes as string) ?? null,
    done_at: (row.done_at as string) ?? null,
    updated_at: String(row.updated_at),
    created_at: String(row.created_at),
  };
}

export async function listApplications(
  db: Client,
  filters: ListFilters = {}
): Promise<ApplicationRow[]> {
  await ensureSchema(db);
  const where: string[] = [];
  const args: (string | number | null)[] = [];

  if (filters.status) {
    const s = filters.status.trim();
    if (s.toLowerCase() === "needs deisy" || s === "Needs-Deisy") {
      where.push(`status = 'Needs-Deisy'`);
    } else {
      where.push(`status = ?`);
      args.push(s);
    }
  }
  if (filters.since) {
    where.push(`updated_at >= ?`);
    args.push(filters.since);
  }
  if (filters.company) {
    where.push(`company LIKE ?`);
    args.push(`%${filters.company}%`);
  }
  if (filters.cv) {
    where.push(`cv = ?`);
    args.push(filters.cv.toUpperCase());
  }
  if (filters.from) {
    where.push(`date_found >= ?`);
    args.push(filters.from);
  }
  if (filters.to) {
    where.push(`date_found <= ?`);
    args.push(filters.to);
  }

  const sql = `
    SELECT * FROM applications
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE WHEN status = 'Needs-Deisy' AND done_at IS NULL THEN 0 ELSE 1 END,
      date_found DESC,
      id DESC
  `;

  const result = await db.execute({ sql, args });
  return result.rows.map((r) => rowToApp(r as Record<string, unknown>));
}

export async function getApplication(
  db: Client,
  id: string
): Promise<ApplicationRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM applications WHERE id = ?`,
    args: [normalizeId(id)],
  });
  if (!result.rows[0]) return null;
  return rowToApp(result.rows[0] as Record<string, unknown>);
}

export async function getNotes(
  db: Client,
  applicationId: string
): Promise<NoteRow[]> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM notes WHERE application_id = ? ORDER BY created_at ASC`,
    args: [normalizeId(applicationId)],
  });
  return result.rows.map((r) => ({
    id: Number(r.id),
    application_id: String(r.application_id),
    author: r.author as NoteRow["author"],
    body: String(r.body),
    created_at: String(r.created_at),
  }));
}

export async function addNote(
  db: Client,
  applicationId: string,
  author: NoteRow["author"],
  body: string
): Promise<NoteRow> {
  await ensureSchema(db);
  const id = normalizeId(applicationId);
  const created_at = nowIso();
  const result = await db.execute({
    sql: `INSERT INTO notes (application_id, author, body, created_at) VALUES (?, ?, ?, ?) RETURNING *`,
    args: [id, author, body.trim(), created_at],
  });
  await db.execute({
    sql: `UPDATE applications SET updated_at = ? WHERE id = ?`,
    args: [created_at, id],
  });
  const r = result.rows[0];
  return {
    id: Number(r.id),
    application_id: String(r.application_id),
    author: r.author as NoteRow["author"],
    body: String(r.body),
    created_at: String(r.created_at),
  };
}

export async function markDone(
  db: Client,
  applicationId: string,
  done = true
): Promise<ApplicationRow | null> {
  await ensureSchema(db);
  const id = normalizeId(applicationId);
  const updated_at = nowIso();
  const done_at = done ? updated_at : null;
  await db.execute({
    sql: `UPDATE applications SET done_at = ?, updated_at = ? WHERE id = ?`,
    args: [done_at, updated_at, id],
  });
  return getApplication(db, id);
}

export async function getUpdates(
  db: Client,
  since: string
): Promise<{
  done: ApplicationRow[];
  notes: NoteRow[];
}> {
  await ensureSchema(db);
  const doneResult = await db.execute({
    sql: `SELECT * FROM applications WHERE done_at IS NOT NULL AND done_at >= ? ORDER BY done_at ASC`,
    args: [since],
  });
  const notesResult = await db.execute({
    sql: `SELECT * FROM notes WHERE created_at >= ? ORDER BY created_at ASC`,
    args: [since],
  });
  return {
    done: doneResult.rows.map((r) => rowToApp(r as Record<string, unknown>)),
    notes: notesResult.rows.map((r) => ({
      id: Number(r.id),
      application_id: String(r.application_id),
      author: r.author as NoteRow["author"],
      body: String(r.body),
      created_at: String(r.created_at),
    })),
  };
}
