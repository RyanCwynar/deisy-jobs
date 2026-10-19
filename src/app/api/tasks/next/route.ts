import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { nextTasks, taskPublicView } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 20;
  const db = await ensureSchema(getDb());
  const tasks = await nextTasks(db, Number.isFinite(limit) ? limit : 20);
  return NextResponse.json({
    tasks: tasks.map(taskPublicView),
    count: tasks.length,
  });
}
