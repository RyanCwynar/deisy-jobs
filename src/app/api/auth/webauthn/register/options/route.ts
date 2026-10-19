import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { beginRegistration } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await ensureSchema(getDb());
    const options = await beginRegistration(db, session, req);
    return NextResponse.json(options);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Options failed" },
      { status: 500 }
    );
  }
}
