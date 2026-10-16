import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { getUpdates } from "@/lib/applications";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const since = req.nextUrl.searchParams.get("since");
  if (!since) {
    return NextResponse.json(
      { error: "since query param (ISO) required" },
      { status: 400 }
    );
  }

  const db = await ensureSchema(getDb());
  const updates = await getUpdates(db, since);
  return NextResponse.json({
    since,
    done: updates.done,
    notes: updates.notes,
  });
}
