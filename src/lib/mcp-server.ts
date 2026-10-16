import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Client } from "@libsql/client";
import {
  MCP_TOOL_DESCRIPTIONS,
  toolAddNote,
  toolGetApplication,
  toolGetResume,
  toolListApplications,
  toolListChanges,
  toolListNeedsDeisy,
  toolListResumes,
  toolMarkDone,
  toolUpdateStatus,
  toolUploadResume,
  toolUpsertApplication,
  type McpCaller,
} from "./mcp-tools";

const optionalNullableString = z.string().nullable().optional();

export function createDeisyMcpServer(db: Client, caller: McpCaller): McpServer {
  const server = new McpServer({
    name: "deisy-jobs",
    version: "0.1.0",
  });

  server.registerTool(
    "list_applications",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_applications,
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe("Filtro de estado / Status filter (e.g. Needs-Deisy)"),
        since: z
          .string()
          .optional()
          .describe("Solo actualizados desde ISO / Only updated since ISO timestamp"),
        company: z
          .string()
          .optional()
          .describe("Búsqueda parcial de empresa / Partial company match"),
      },
    },
    async (args) => toolListApplications(db, caller, args)
  );

  server.registerTool(
    "get_application",
    {
      description: MCP_TOOL_DESCRIPTIONS.get_application,
      inputSchema: {
        id: z.string().describe("ID de la solicitud / Application id"),
      },
    },
    async (args) => toolGetApplication(db, caller, args)
  );

  server.registerTool(
    "list_needs_deisy",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_needs_deisy,
      inputSchema: {},
    },
    async () => toolListNeedsDeisy(db, caller)
  );

  server.registerTool(
    "mark_done",
    {
      description: MCP_TOOL_DESCRIPTIONS.mark_done,
      inputSchema: {
        id: z.string().describe("ID de la solicitud / Application id"),
        done: z
          .boolean()
          .optional()
          .describe("true para hecha, false para reabrir / true done, false reopen"),
      },
    },
    async (args) => toolMarkDone(db, caller, args)
  );

  server.registerTool(
    "add_note",
    {
      description: MCP_TOOL_DESCRIPTIONS.add_note,
      inputSchema: {
        id: z.string().describe("ID de la solicitud / Application id"),
        body: z.string().min(1).describe("Texto de la nota / Note body"),
      },
    },
    async (args) => toolAddNote(db, caller, args)
  );

  server.registerTool(
    "list_resumes",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_resumes,
      inputSchema: {},
    },
    async () => toolListResumes(db, caller)
  );

  server.registerTool(
    "get_resume",
    {
      description: MCP_TOOL_DESCRIPTIONS.get_resume,
      inputSchema: {
        lang: z
          .enum(["en", "es"])
          .describe("Idioma del CV / Resume language (en or es)"),
      },
    },
    async (args) => toolGetResume(db, caller, args)
  );

  server.registerTool(
    "upsert_application",
    {
      description: MCP_TOOL_DESCRIPTIONS.upsert_application,
      inputSchema: {
        id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("ID opcional; sin id se genera / Optional id; auto when omitted"),
        date_found: optionalNullableString,
        company: optionalNullableString.describe("Requerido al crear / Required on create"),
        role: optionalNullableString.describe("Requerido al crear / Required on create"),
        location: optionalNullableString,
        listed_pay: optionalNullableString,
        cv: optionalNullableString,
        apply_link: optionalNullableString,
        status: optionalNullableString,
        raw_status: optionalNullableString,
        status_reason: optionalNullableString,
        date_applied: optionalNullableString,
        notes: optionalNullableString,
      },
    },
    async (args) => toolUpsertApplication(db, caller, args)
  );

  server.registerTool(
    "update_status",
    {
      description: MCP_TOOL_DESCRIPTIONS.update_status,
      inputSchema: {
        id: z.string().describe("ID de la solicitud / Application id"),
        status: z.string().describe("Nuevo estado / New status"),
      },
    },
    async (args) => toolUpdateStatus(db, caller, args)
  );

  server.registerTool(
    "upload_resume",
    {
      description: MCP_TOOL_DESCRIPTIONS.upload_resume,
      inputSchema: {
        lang: z.enum(["en", "es"]),
        file_base64: z.string().describe("PDF en base64 / PDF as base64"),
        filename: z.string().optional(),
      },
    },
    async (args) => toolUploadResume(db, caller, args)
  );

  server.registerTool(
    "list_changes",
    {
      description: MCP_TOOL_DESCRIPTIONS.list_changes,
      inputSchema: {
        since: z.string().optional().describe("ISO timestamp"),
        actor: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async (args) => toolListChanges(db, caller, args)
  );

  return server;
}
