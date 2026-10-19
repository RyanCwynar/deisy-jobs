import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import {
  credentialPublicView,
  listCredentialsForEmail,
} from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await ensureSchema(getDb());
    const creds = await listCredentialsForEmail(db, session.email);
    return NextResponse.json({
      credentials: creds.map(credentialPublicView),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List failed" },
      { status: 500 }
    );
  }
}
