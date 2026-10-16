import type { Client } from "@libsql/client";
import {
  addNote,
  getApplication,
  getNotes,
  listApplications,
  markDone,
} from "./applications";
import { hasScope, type ApiScope } from "./scopes";

export type McpCaller = {
  scopes: readonly ApiScope[] | readonly string[];
  author: string;
};

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
  const application = await markDone(db, args.id, args.done ?? true);
  if (!application) return errorResult("Not found");
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
  return textResult({ ok: true, note });
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
} as const;
