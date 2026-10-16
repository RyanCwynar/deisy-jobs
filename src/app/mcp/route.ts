import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getBearerToken, resolveAccess } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { createDeisyMcpServer } from "@/lib/mcp-server";
import { mcpCallerFromPrincipal } from "@/lib/mcp-tools";
import type { ApiScope } from "@/lib/scopes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleMcp(req: NextRequest): Promise<Response> {
  const access = await resolveAccess(req);
  if (!access) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="deisy-jobs-mcp"' },
      }
    );
  }

  const token = getBearerToken(req) ?? "";
  const scopes = [...access.scopes] as ApiScope[];
  const authInfo: AuthInfo = {
    token,
    clientId: access.kind === "token" ? access.name : access.kind === "env" ? access.name : access.user.name,
    scopes,
    extra: {
      author: access.author,
      kind: access.kind,
    },
  };

  const db = await ensureSchema(getDb());
  const server = createDeisyMcpServer(db, mcpCallerFromPrincipal(access));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req, { authInfo });
}

export async function GET(req: NextRequest) {
  return handleMcp(req);
}

export async function POST(req: NextRequest) {
  return handleMcp(req);
}

export async function DELETE(req: NextRequest) {
  return handleMcp(req);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Accept, mcp-session-id, Last-Event-ID, mcp-protocol-version",
      "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
    },
  });
}
