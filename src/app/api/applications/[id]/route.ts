import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { getApplication, getNotes } from "@/lib/applications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const app = await getApplication(db, id);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const notes = await getNotes(db, id);
  return NextResponse.json({ application: app, notes });
}
