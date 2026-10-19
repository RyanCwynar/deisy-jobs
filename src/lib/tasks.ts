import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { ensureSchema, type ApplicationRow } from "./db";
import { getApplication } from "./applications";

export const TASK_KINDS = [
  "photo",
  "video",
  "audio",
  "assessment",
  "essay",
  "account",
  "answer",
  "upload",
  "interview",
  "other",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ["open", "done", "snoozed", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskRow = {
  id: string;
  title: string;
  detail: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  application_id: string | null;
  created_by: string;
  created_at: string;
  done_at: string | null;
  reply: string | null;
  snoozed_until: string | null;
  seed_key: string | null;
};

export type TaskWithApps = TaskRow & {
  application_ids: string[];
  applications: ApplicationRow[];
  linked_count: number;
  max_pay_score: number;
  instruction: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function rowToTask(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row.id),
    title: String(row.title),
    detail: String(row.detail ?? ""),
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    priority: Number(row.priority ?? 0),
    due_date: (row.due_date as string) ?? null,
    application_id: (row.application_id as string) ?? null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    done_at: (row.done_at as string) ?? null,
    reply: (row.reply as string) ?? null,
    snoozed_until: (row.snoozed_until as string) ?? null,
    seed_key: (row.seed_key as string) ?? null,
  };
}

export function parseTaskKind(raw: string | null | undefined): TaskKind | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (TASK_KINDS as readonly string[]).includes(v) ? (v as TaskKind) : null;
}

export function parseTaskStatus(
  raw: string | null | undefined
): TaskStatus | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (TASK_STATUSES as readonly string[]).includes(v)
    ? (v as TaskStatus)
    : null;
}

/** Rough USD-monthly-equivalent score for ranking (higher = better pay). */
export function payScore(listedPay: string | null | undefined): number {
  if (!listedPay) return 0;
  const s = listedPay.toLowerCase().replace(/,/g, "");
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!nums.length) return 0;
  const max = Math.max(...nums);
  if (/cop|col\$/.test(s)) {
    // COP monthly → rough USD (≈4000 COP/USD)
    return max / 4000;
  }
  if (/\/\s*yr|per year|annual|\/year/.test(s)) return max / 12;
  if (/\/\s*hr|per hour|hourly/.test(s)) return max * 160;
  if (/k\b/.test(s) && max < 1000) return (max * 1000) / 12;
  return max;
}

export async function getTask(
  db: Client,
  id: string
): Promise<TaskRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM tasks WHERE id = ?`,
    args: [id],
  });
  if (!result.rows[0]) return null;
  return rowToTask(result.rows[0] as Record<string, unknown>);
}

export async function getTaskApplicationIds(
  db: Client,
  taskId: string
): Promise<string[]> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT application_id FROM task_applications WHERE task_id = ? ORDER BY application_id`,
    args: [taskId],
  });
  return result.rows.map((r) => String(r.application_id));
}

export async function setTaskApplications(
  db: Client,
  taskId: string,
  applicationIds: string[]
): Promise<void> {
  await ensureSchema(db);
  const unique = [...new Set(applicationIds.map((id) => String(id).trim()).filter(Boolean))];
  await db.execute({
    sql: `DELETE FROM task_applications WHERE task_id = ?`,
    args: [taskId],
  });
  for (const appId of unique) {
    const app = await getApplication(db, appId);
    if (!app) continue;
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_applications (task_id, application_id) VALUES (?, ?)`,
      args: [taskId, app.id],
    });
  }
  const primary = unique[0] ?? null;
  await db.execute({
    sql: `UPDATE tasks SET application_id = ? WHERE id = ?`,
    args: [primary, taskId],
  });
}

async function hydrateTask(
  db: Client,
  task: TaskRow
): Promise<TaskWithApps> {
  const application_ids = await getTaskApplicationIds(db, task.id);
  const applications: ApplicationRow[] = [];
  for (const id of application_ids) {
    const app = await getApplication(db, id);
    if (app) applications.push(app);
  }
  const max_pay_score = applications.reduce(
    (m, a) => Math.max(m, payScore(a.listed_pay)),
    0
  );
  const instruction =
    task.detail.trim() ||
    `Do this: ${task.title}` +
      (applications.length
        ? ` (unblocks: ${applications.map((a) => a.company).join(", ")})`
        : "");
  return {
    ...task,
    application_ids,
    applications,
    linked_count: applications.length,
    max_pay_score,
    instruction,
  };
}

export async function getTaskWithApps(
  db: Client,
  id: string
): Promise<TaskWithApps | null> {
  const task = await getTask(db, id);
  if (!task) return null;
  return hydrateTask(db, task);
}

export type CreateTaskInput = {
  title: string;
  detail?: string;
  kind: TaskKind;
  application_ids: string[];
  priority?: number;
  due_date?: string | null;
  created_by: string;
  seed_key?: string | null;
  status?: TaskStatus;
};

export async function createTask(
  db: Client,
  input: CreateTaskInput
): Promise<TaskWithApps> {
  await ensureSchema(db);
  const id = randomUUID();
  const created_at = nowIso();
  const title = input.title.trim();
  if (!title) throw new Error("title is required");
  if (!input.application_ids?.length) {
    throw new Error("application_ids is required");
  }
  await db.execute({
    sql: `
      INSERT INTO tasks (
        id, title, detail, kind, status, priority, due_date, application_id,
        created_by, created_at, done_at, reply, snoozed_until, seed_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?)
    `,
    args: [
      id,
      title,
      (input.detail ?? "").trim(),
      input.kind,
      input.status ?? "open",
      input.priority ?? 0,
      input.due_date ?? null,
      input.created_by,
      created_at,
      input.seed_key ?? null,
    ],
  });
  await setTaskApplications(db, id, input.application_ids);
  const task = await getTaskWithApps(db, id);
  if (!task) throw new Error("Failed to create task");
  return task;
}

export type UpdateTaskInput = {
  title?: string;
  detail?: string;
  kind?: TaskKind;
  priority?: number;
  due_date?: string | null;
  application_ids?: string[];
};

export async function updateTask(
  db: Client,
  id: string,
  input: UpdateTaskInput
): Promise<TaskWithApps | null> {
  await ensureSchema(db);
  const existing = await getTask(db, id);
  if (!existing) return null;
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("title cannot be empty");
    sets.push(`title = ?`);
    args.push(title);
  }
  if (input.detail !== undefined) {
    sets.push(`detail = ?`);
    args.push(input.detail.trim());
  }
  if (input.kind !== undefined) {
    sets.push(`kind = ?`);
    args.push(input.kind);
  }
  if (input.priority !== undefined) {
    sets.push(`priority = ?`);
    args.push(input.priority);
  }
  if (input.due_date !== undefined) {
    sets.push(`due_date = ?`);
    args.push(input.due_date);
  }
  if (sets.length) {
    args.push(id);
    await db.execute({
      sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`,
      args,
    });
  }
  if (input.application_ids) {
    await setTaskApplications(db, id, input.application_ids);
  }
  return getTaskWithApps(db, id);
}

export async function completeTask(
  db: Client,
  id: string,
  note?: string | null
): Promise<TaskWithApps | null> {
  await ensureSchema(db);
  const existing = await getTask(db, id);
  if (!existing) return null;
  const done_at = nowIso();
  await db.execute({
    sql: `UPDATE tasks SET status = 'done', done_at = ?, reply = COALESCE(?, reply), snoozed_until = NULL WHERE id = ?`,
    args: [done_at, note?.trim() || null, id],
  });
  return getTaskWithApps(db, id);
}

export async function snoozeTask(
  db: Client,
  id: string,
  opts: { until?: string; days?: number }
): Promise<TaskWithApps | null> {
  await ensureSchema(db);
  const existing = await getTask(db, id);
  if (!existing) return null;
  let until = opts.until?.trim() || null;
  if (!until) {
    const days = opts.days && opts.days > 0 ? opts.days : 3;
    until = new Date(Date.now() + days * 86400000).toISOString();
  }
  await db.execute({
    sql: `UPDATE tasks SET status = 'snoozed', snoozed_until = ?, done_at = NULL WHERE id = ?`,
    args: [until, id],
  });
  return getTaskWithApps(db, id);
}

export async function dropTask(
  db: Client,
  id: string
): Promise<TaskWithApps | null> {
  await ensureSchema(db);
  const existing = await getTask(db, id);
  if (!existing) return null;
  await db.execute({
    sql: `UPDATE tasks SET status = 'dropped', snoozed_until = NULL WHERE id = ?`,
    args: [id],
  });
  return getTaskWithApps(db, id);
}

export type ListTasksFilters = {
  status?: TaskStatus;
  application_id?: string;
};

export async function listTasks(
  db: Client,
  filters: ListTasksFilters = {}
): Promise<TaskWithApps[]> {
  await ensureSchema(db);
  let taskIds: string[] | null = null;
  if (filters.application_id) {
    const links = await db.execute({
      sql: `SELECT task_id FROM task_applications WHERE application_id = ?`,
      args: [filters.application_id],
    });
    taskIds = links.rows.map((r) => String(r.task_id));
    if (!taskIds.length) return [];
  }

  const where: string[] = [];
  const args: (string | number | null)[] = [];
  if (filters.status) {
    where.push(`status = ?`);
    args.push(filters.status);
  }
  if (taskIds) {
    where.push(`id IN (${taskIds.map(() => "?").join(",")})`);
    args.push(...taskIds);
  }

  const result = await db.execute({
    sql: `
      SELECT * FROM tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
    `,
    args,
  });
  const out: TaskWithApps[] = [];
  for (const row of result.rows) {
    out.push(await hydrateTask(db, rowToTask(row as Record<string, unknown>)));
  }
  return out;
}

/** Open tasks + snoozed whose until has passed, ranked for Deisy. */
export async function nextTasks(
  db: Client,
  limit = 20
): Promise<TaskWithApps[]> {
  await ensureSchema(db);
  const now = nowIso();
  const result = await db.execute({
    sql: `
      SELECT * FROM tasks
      WHERE status = 'open'
         OR (status = 'snoozed' AND (snoozed_until IS NULL OR snoozed_until <= ?))
    `,
    args: [now],
  });
  const hydrated: TaskWithApps[] = [];
  for (const row of result.rows) {
    hydrated.push(
      await hydrateTask(db, rowToTask(row as Record<string, unknown>))
    );
  }
  hydrated.sort((a, b) => {
    if (b.linked_count !== a.linked_count) return b.linked_count - a.linked_count;
    if (b.max_pay_score !== a.max_pay_score) return b.max_pay_score - a.max_pay_score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.created_at.localeCompare(b.created_at);
  });
  const n = Math.min(Math.max(limit, 1), 100);
  return hydrated.slice(0, n);
}

export async function findTaskBySeedKey(
  db: Client,
  seedKey: string
): Promise<TaskRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM tasks WHERE seed_key = ?`,
    args: [seedKey],
  });
  if (!result.rows[0]) return null;
  return rowToTask(result.rows[0] as Record<string, unknown>);
}

export function taskPublicView(task: TaskWithApps) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    application_id: task.application_id,
    application_ids: task.application_ids,
    applications: task.applications.map((a) => ({
      id: a.id,
      company: a.company,
      role: a.role,
      listed_pay: a.listed_pay,
      apply_link: a.apply_link,
      status: a.status,
      status_reason: a.status_reason,
      cv: a.cv,
      location: a.location,
    })),
    linked_count: task.linked_count,
    instruction: task.instruction,
    created_by: task.created_by,
    created_at: task.created_at,
    done_at: task.done_at,
    reply: task.reply,
    snoozed_until: task.snoozed_until,
    seed_key: task.seed_key,
  };
}

export function stableSeedKey(normalizedTitle: string, appIds: string[]): string {
  const apps = [...appIds].map(String).sort().join(",");
  const base = `${normalizedTitle.trim().toLowerCase()}|${apps}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}
