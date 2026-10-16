import type { Client } from "@libsql/client";
import {
  addNote,
  getApplication,
  getNotes,
  listApplications,
  markDone,
} from "./applications";
import {
  createSignedResumeUrl,
  getLatestResume,
  listCurrentResumes,
  parseResumeLang,
  readResumeBytes,
  resumePublicMeta,
} from "./resumes";
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
} as const;
