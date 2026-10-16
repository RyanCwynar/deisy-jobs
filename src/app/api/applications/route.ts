import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { listApplications } from "@/lib/applications";

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
  const db = await ensureSchema(getDb());
  const apps = await listApplications(db, {
    status: searchParams.get("status") ?? undefined,
    since: searchParams.get("since") ?? undefined,
    company: searchParams.get("company") ?? undefined,
    cv: searchParams.get("cv") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  return NextResponse.json({ applications: apps, count: apps.length });
}
