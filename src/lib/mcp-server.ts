import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Client } from "@libsql/client";
import {
  MCP_TOOL_DESCRIPTIONS,
  toolAddNote,
  toolGetApplication,
  toolGetResume,
  toolListApplications,
  toolListNeedsDeisy,
  toolListResumes,
  toolMarkDone,
  type McpCaller,
} from "./mcp-tools";

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

  return server;
}
