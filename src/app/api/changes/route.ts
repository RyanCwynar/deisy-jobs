import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { listChanges } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const { searchParams } = req.nextUrl;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const db = await ensureSchema(getDb());
  const changes = await listChanges(db, {
    since: searchParams.get("since") ?? undefined,
    actor: searchParams.get("actor") ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return NextResponse.json({ changes, count: changes.length });
}
