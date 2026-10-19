import { createClient, type Client } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";

let client: Client | null = null;
let schemaReady = false;

function resolveDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const file = path.join(process.cwd(), "data", "deisy-jobs.db");
  return `file:${file}`;
}

export function getDb(): Client {
  if (!client) {
    const url = resolveDbUrl();
    if (url.startsWith("file:")) {
      const filePath = url.slice("file:".length);
      const dir = path.dirname(filePath);
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    }
    client = createClient({ url });
  }
  return client;
}

/** Reset cached client (tests). */
export function resetDb(): void {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  client = null;
  schemaReady = false;
}

async function migrateNotesAuthorConstraint(db: Client): Promise<void> {
  const meta = await db.execute(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes'`
  );
  const sql = String(meta.rows[0]?.sql ?? "");
  if (!sql) return;
  // Old schema restricted authors; token owners (e.g. deisy-bot) need free-form names.
  if (!/CHECK\s*\(\s*author\s+IN/i.test(sql)) return;

  await db.execute(`
    CREATE TABLE notes_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);
  await db.execute(
    `INSERT INTO notes_migrated (id, application_id, author, body, created_at)
     SELECT id, application_id, author, body, created_at FROM notes`
  );
  await db.execute(`DROP TABLE notes`);
  await db.execute(`ALTER TABLE notes_migrated RENAME TO notes`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_notes_application ON notes(application_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at)`
  );
}

export async function ensureSchema(db: Client = getDb()): Promise<Client> {
  if (schemaReady && db === client) return db;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS applications (
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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);

  await migrateNotesAuthorConstraint(db);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scopes TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_applications_company ON applications(company)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications(updated_at)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_notes_application ON notes(application_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      lang TEXT NOT NULL CHECK (lang IN ('en', 'es')),
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_resumes_lang_created ON resumes(lang, created_at DESC)`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS change_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      token_id TEXT,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      diff TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_change_log_at ON change_log(at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_change_log_actor ON change_log(actor)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity, entity_id)`
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      application_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      done_at TEXT,
      reply TEXT,
      snoozed_until TEXT,
      seed_key TEXT UNIQUE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_applications (
      task_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      PRIMARY KEY (task_id, application_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_tasks_seed_key ON tasks(seed_key)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_task_applications_app ON task_applications(application_id)`
  );

  if (db === client) schemaReady = true;
  return db;
}

export type ApplicationRow = {
  id: string;
  date_found: string | null;
  company: string;
  role: string;
  location: string | null;
  listed_pay: string | null;
  cv: string | null;
  apply_link: string | null;
  status: string;
  status_reason: string | null;
  raw_status: string | null;
  date_applied: string | null;
  notes: string | null;
  done_at: string | null;
  updated_at: string;
  created_at: string;
};

export type NoteRow = {
  id: number;
  application_id: string;
  author: string;
  body: string;
  created_at: string;
};

export type ApplicationInput = {
  id: string;
  date_found?: string | null;
  company: string;
  role: string;
  location?: string | null;
  listed_pay?: string | null;
  cv?: string | null;
  apply_link?: string | null;
  status?: string | null;
  raw_status?: string | null;
  status_reason?: string | null;
  date_applied?: string | null;
  notes?: string | null;
};
