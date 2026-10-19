import type { Client } from "@libsql/client";
import {
  addNote,
  getApplication,
  getNotes,
  listApplications,
  markDone,
  patchOrCreateApplication,
  updateApplicationStatus,
  type ApplicationPatch,
} from "./applications";
import {
  actorFromPrincipal,
  diffFields,
  listChanges,
  recordChange,
  type AuditActor,
} from "./changelog";
import type { AccessPrincipal } from "./auth";
import {
  createSignedResumeUrl,
  getLatestResume,
  listCurrentResumes,
  parseResumeLang,
  readResumeBytes,
  resumePublicMeta,
  storeResume,
} from "./resumes";
import { hasScope, type ApiScope } from "./scopes";
import {
  completeTask,
  createTask,
  dropTask,
  listTasks,
  nextTasks,
  parseTaskKind,
  parseTaskStatus,
  snoozeTask,
  taskPublicView,
  updateTask,
  type TaskKind,
} from "./tasks";

export type McpCaller = AuditActor & {
  scopes: readonly ApiScope[] | readonly string[];
  author: string;
};

export function mcpCallerFromPrincipal(principal: AccessPrincipal): McpCaller {
  const audit = actorFromPrincipal(principal);
  return {
    scopes: principal.scopes,
    author: principal.author,
    actor: audit.actor,
    token_id: audit.token_id,
  };
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function requireCallerScope(caller: McpCaller, scope: ApiScope) {
  if (!hasScope(caller.scopes, scope)) {
    return errorResult(`Missing scope: ${scope}`);
  }
  return null;
}

export async function toolListApplications(
  db: Client,
  caller: McpCaller,
  args: { status?: string; since?: string; company?: string }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const applications = await listApplications(db, {
    status: args.status,
    since: args.since,
    company: args.company,
  });
  return textResult({ applications, count: applications.length });
}

export async function toolGetApplication(
  db: Client,
  caller: McpCaller,
  args: { id: string }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const application = await getApplication(db, args.id);
  if (!application) return errorResult("Not found");
  const notes = await getNotes(db, args.id);
  return textResult({ application, notes });
}

export async function toolListNeedsDeisy(db: Client, caller: McpCaller) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const applications = await listApplications(db, { status: "Needs-Deisy" });
  const open = applications.filter((a) => !a.done_at);
  return textResult({ applications: open, count: open.length });
}

export async function toolMarkDone(
  db: Client,
  caller: McpCaller,
  args: { id: string; done?: boolean }
) {
  const denied = requireCallerScope(caller, "notes");
  if (denied) return denied;
  const before = await getApplication(db, args.id);
  if (!before) return errorResult("Not found");
  const application = await markDone(db, args.id, args.done ?? true);
  if (!application) return errorResult("Not found");
  await recordChange(db, {
    actor: caller.actor,
    token_id: caller.token_id,
    entity: "application",
    entity_id: application.id,
    action: "update",
    diff: {
      fields: diffFields(
        { done_at: before.done_at },
        { done_at: application.done_at }
      ),
    },
  });
  return textResult({ ok: true, application });
}

export async function toolAddNote(
  db: Client,
  caller: McpCaller,
  args: { id: string; body: string }
) {
  const denied = requireCallerScope(caller, "notes");
  if (denied) return denied;
  const application = await getApplication(db, args.id);
  if (!application) return errorResult("Not found");
  const note = await addNote(db, args.id, caller.author, args.body);
  await recordChange(db, {
    actor: caller.actor,
    token_id: caller.token_id,
    entity: "note",
    entity_id: String(note.id),
    action: "create",
    diff: {
      application_id: note.application_id,
      author: note.author,
      body: note.body,
    },
  });
  return textResult({ ok: true, note });
}

export async function toolListResumes(db: Client, caller: McpCaller) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const current = await listCurrentResumes(db);
  return textResult({
    resumes: current.map((r) => ({
      lang: r.lang,
      filename: r.filename,
      size: r.size,
      updated_at: r.created_at,
      sha256: r.sha256,
    })),
    count: current.length,
  });
}

export async function toolGetResume(
  db: Client,
  caller: McpCaller,
  args: { lang: string }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const lang = parseResumeLang(args.lang);
  if (!lang) return errorResult("lang must be en or es");
  const resume = await getLatestResume(db, lang);
  if (!resume) return errorResult("Not found");

  let bytes: Buffer;
  try {
    bytes = readResumeBytes(resume);
  } catch {
    return errorResult("File missing on disk");
  }

  const signed = createSignedResumeUrl(lang);
  const blob = bytes.toString("base64");
  const uri = `resume://${lang}/${resume.id}.pdf`;

  return {
    content: [
      {
        type: "resource" as const,
        resource: {
          uri,
          mimeType: "application/pdf",
          blob,
        },
      },
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...resumePublicMeta(resume),
            signed_url: signed.signed_url,
            expires_at: signed.expires_at,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function toolUpsertApplication(
  db: Client,
  caller: McpCaller,
  args: ApplicationPatch
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  try {
    const result = await patchOrCreateApplication(db, args);
    const fields = diffFields(result.before, result.after);
    await recordChange(db, {
      actor: caller.actor,
      token_id: caller.token_id,
      entity: "application",
      entity_id: result.application.id,
      action: result.created ? "create" : "update",
      diff: { fields },
    });
    return textResult({
      ok: true,
      created: result.created,
      application: result.application,
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Upsert failed");
  }
}

export async function toolUpdateStatus(
  db: Client,
  caller: McpCaller,
  args: { id: string; status: string }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  try {
    const result = await updateApplicationStatus(db, args.id, args.status);
    await recordChange(db, {
      actor: caller.actor,
      token_id: caller.token_id,
      entity: "application",
      entity_id: result.application.id,
      action: "update",
      diff: { fields: diffFields(result.before, result.after) },
    });
    return textResult({ ok: true, application: result.application });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return errorResult(message);
  }
}

export async function toolUploadResume(
  db: Client,
  caller: McpCaller,
  args: { lang: string; file_base64: string; filename?: string }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  const lang = parseResumeLang(args.lang);
  if (!lang) return errorResult("lang must be en or es");
  let data: Buffer;
  try {
    data = Buffer.from(args.file_base64, "base64");
  } catch {
    return errorResult("Invalid base64");
  }
  if (!data.length) return errorResult("Empty file");
  try {
    const resume = await storeResume(db, {
      lang,
      filename: args.filename || `resume-${lang}.pdf`,
      contentType: "application/pdf",
      data,
    });
    await recordChange(db, {
      actor: caller.actor,
      token_id: caller.token_id,
      entity: "resume",
      entity_id: resume.id,
      action: "create",
      diff: {
        lang: resume.lang,
        filename: resume.filename,
        size: resume.size,
        sha256: resume.sha256,
      },
    });
    return textResult({ ok: true, resume: resumePublicMeta(resume) });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Upload failed");
  }
}

export async function toolListChanges(
  db: Client,
  caller: McpCaller,
  args: { since?: string; actor?: string; limit?: number }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const changes = await listChanges(db, {
    since: args.since,
    actor: args.actor,
    limit: args.limit,
  });
  return textResult({ changes, count: changes.length });
}

export async function toolNextTasks(
  db: Client,
  caller: McpCaller,
  args: { limit?: number }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const tasks = await nextTasks(db, args.limit ?? 20);
  return textResult({
    tasks: tasks.map(taskPublicView),
    count: tasks.length,
  });
}

export async function toolListTasks(
  db: Client,
  caller: McpCaller,
  args: { status?: string; application_id?: string }
) {
  const denied = requireCallerScope(caller, "read");
  if (denied) return denied;
  const status = args.status ? parseTaskStatus(args.status) : undefined;
  if (args.status && !status) return errorResult("Invalid status");
  const tasks = await listTasks(db, {
    status: status ?? undefined,
    application_id: args.application_id,
  });
  return textResult({ tasks: tasks.map(taskPublicView), count: tasks.length });
}

export async function toolCreateTask(
  db: Client,
  caller: McpCaller,
  args: {
    title: string;
    detail?: string;
    kind: string;
    application_ids: string[];
    priority?: number;
    due_date?: string | null;
  }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  const kind = parseTaskKind(args.kind);
  if (!kind) return errorResult("Invalid kind");
  try {
    const task = await createTask(db, {
      title: args.title,
      detail: args.detail,
      kind,
      application_ids: args.application_ids,
      priority: args.priority,
      due_date: args.due_date,
      created_by: caller.actor,
    });
    await recordChange(db, {
      actor: caller.actor,
      token_id: caller.token_id,
      entity: "task",
      entity_id: task.id,
      action: "create",
      diff: {
        title: task.title,
        kind: task.kind,
        application_ids: task.application_ids,
      },
    });
    return textResult({ ok: true, task: taskPublicView(task) });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Create failed");
  }
}

export async function toolUpdateTask(
  db: Client,
  caller: McpCaller,
  args: {
    id: string;
    title?: string;
    detail?: string;
    priority?: number;
    due_date?: string | null;
    kind?: string;
    application_ids?: string[];
  }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  let kind: TaskKind | undefined;
  if (args.kind !== undefined) {
    const parsed = parseTaskKind(args.kind);
    if (!parsed) return errorResult("Invalid kind");
    kind = parsed;
  }
  try {
    const task = await updateTask(db, args.id, {
      title: args.title,
      detail: args.detail,
      priority: args.priority,
      due_date: args.due_date,
      kind,
      application_ids: args.application_ids,
    });
    if (!task) return errorResult("Not found");
    await recordChange(db, {
      actor: caller.actor,
      token_id: caller.token_id,
      entity: "task",
      entity_id: task.id,
      action: "update",
      diff: {
        title: task.title,
        detail: task.detail,
        kind: task.kind,
        priority: task.priority,
        due_date: task.due_date,
        application_ids: task.application_ids,
      },
    });
    return textResult({ ok: true, task: taskPublicView(task) });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : "Update failed");
  }
}

export async function toolCompleteTask(
  db: Client,
  caller: McpCaller,
  args: { id: string; note?: string }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  const task = await completeTask(db, args.id, args.note);
  if (!task) return errorResult("Not found");
  await recordChange(db, {
    actor: caller.actor,
    token_id: caller.token_id,
    entity: "task",
    entity_id: task.id,
    action: "update",
    diff: { status: "done", reply: task.reply },
  });
  return textResult({ ok: true, task: taskPublicView(task) });
}

export async function toolSnoozeTask(
  db: Client,
  caller: McpCaller,
  args: { id: string; until?: string; days?: number }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  const task = await snoozeTask(db, args.id, {
    until: args.until,
    days: args.days,
  });
  if (!task) return errorResult("Not found");
  await recordChange(db, {
    actor: caller.actor,
    token_id: caller.token_id,
    entity: "task",
    entity_id: task.id,
    action: "update",
    diff: { status: "snoozed", snoozed_until: task.snoozed_until },
  });
  return textResult({ ok: true, task: taskPublicView(task) });
}

export async function toolDropTask(
  db: Client,
  caller: McpCaller,
  args: { id: string }
) {
  const denied = requireCallerScope(caller, "write");
  if (denied) return denied;
  const task = await dropTask(db, args.id);
  if (!task) return errorResult("Not found");
  await recordChange(db, {
    actor: caller.actor,
    token_id: caller.token_id,
    entity: "task",
    entity_id: task.id,
    action: "update",
    diff: { status: "dropped" },
  });
  return textResult({ ok: true, task: taskPublicView(task) });
}

export const MCP_TOOL_DESCRIPTIONS = {
  list_applications:
    "Lista solicitudes de empleo con filtros opcionales (status, since, company). / List job applications with optional status, since, and company filters.",
  get_application:
    "Obtiene una solicitud por id, incluyendo notas. / Get one application by id, including notes.",
  list_needs_deisy:
    "Lista solicitudes abiertas en estado Needs-Deisy (sin marcar hechas). / List open Needs-Deisy applications (not marked done).",
  mark_done:
    "Marca una solicitud como hecha (o desmarca). Requiere alcance notes. / Mark an application done (or undo). Requires notes scope.",
  add_note:
    "Añade una nota; el autor queda como el dueño del token (p. ej. deisy-bot). Requiere alcance notes. / Add a note; author is the token owner (e.g. deisy-bot). Requires notes scope.",
  list_resumes:
    "Lista los CVs actuales (último por idioma) con lang, filename, size, updated_at y sha256. / List current resumes (latest per language) with lang, filename, size, updated_at, and sha256.",
  get_resume:
    "Obtiene el CV PDF actual de un idioma como recurso embebido (base64) más signed_url y expires_at. / Get the current resume PDF for a language as an embedded resource (base64) plus signed_url and expires_at.",
  upsert_application:
    "Crea o actualiza una solicitud (id opcional; sin id se asigna automáticamente; en update solo parchea campos dados). Requiere write. / Create or update an application (optional id; auto-id when missing; patch only given fields on update). Requires write.",
  update_status:
    "Actualiza solo el estado de una solicitud. Cerrar = status (no hay delete). Requiere write. / Update only an application status. Closing is via status (no delete). Requires write.",
  upload_resume:
    "Sube un CV PDF (base64) para en|es; queda como versión actual. Requiere write. / Upload a resume PDF (base64) for en|es; becomes the current version. Requires write.",
  list_changes:
    "Lista el change_log (since, actor, limit). Requiere read. / List the change_log (since, actor, limit). Requires read.",
  next_tasks:
    "Próximas tareas abiertas (y snoozed vencidas), ordenadas por #apps, pay, priority. Incluye contexto de solicitudes. / Next open (and due-snoozed) tasks ordered by linked apps, pay, priority. Includes application context.",
  list_tasks:
    "Lista tareas con filtro status y/o application_id. / List tasks filtered by status and/or application_id.",
  create_task:
    "Crea una tarea vinculada a una o más solicitudes. Requiere write. / Create a task linked to one or more applications. Requires write. Fields: title, detail?, kind, application_ids[], priority?, due_date?.",
  update_task:
    "Actualiza campos de una tarea. Requiere write. / Update task fields. Requires write.",
  complete_task:
    "Marca tarea hecha (note opcional de Deisy). Requiere write. / Mark task done (optional Deisy note). Requires write.",
  snooze_task:
    "Posponer tarea (until ISO o days). Requiere write. / Snooze task (until ISO or days). Requires write.",
  drop_task:
    "Descarta una tarea. Requiere write. / Drop a task. Requires write.",
} as const;
