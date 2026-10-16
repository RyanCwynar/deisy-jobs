import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { revokeToken, tokenPublicView } from "@/lib/tokens";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || session.name !== "ryan") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const token = await revokeToken(db, id);
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, token: tokenPublicView(token) });
}
