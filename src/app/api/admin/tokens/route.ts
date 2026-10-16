import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { listTokens, mintToken, tokenPublicView } from "@/lib/tokens";

export const dynamic = "force-dynamic";

async function requireRyan(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.name !== "ryan") {
    return null;
  }
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await requireRyan(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const db = await ensureSchema(getDb());
  const tokens = await listTokens(db);
  return NextResponse.json({
    tokens: tokens.map(tokenPublicView),
  });
}

const mintSchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.union([
    z.string().min(1),
    z.array(z.enum(["read", "notes", "ingest", "write"])).min(1),
  ]),
});

export async function POST(req: NextRequest) {
  if (!(await requireRyan(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = mintSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const db = await ensureSchema(getDb());
    const { token, plaintext } = await mintToken(db, parsed.data);
    return NextResponse.json({
      ok: true,
      token: tokenPublicView(token),
      plaintext,
      warning: "Copy the plaintext token now; it will not be shown again.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mint failed" },
      { status: 400 }
    );
  }
}
