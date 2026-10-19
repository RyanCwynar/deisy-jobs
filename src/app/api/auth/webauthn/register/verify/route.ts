import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { credentialPublicView, finishRegistration } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RegistrationResponseJSON;
  try {
    body = (await req.json()) as RegistrationResponseJSON;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.id || !body?.response) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const db = await ensureSchema(getDb());
    const { credential } = await finishRegistration(db, session, body, req);
    return NextResponse.json({
      ok: true,
      credential: credentialPublicView(credential),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verify failed" },
      { status: 400 }
    );
  }
}
