import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { setSessionCookie } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { finishAuthentication } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: AuthenticationResponseJSON;
  try {
    body = (await req.json()) as AuthenticationResponseJSON;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.id || !body?.response) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const db = await ensureSchema(getDb());
    const { user } = await finishAuthentication(db, body, req);
    await setSessionCookie(user);
    return NextResponse.json({
      ok: true,
      user: { email: user.email, name: user.name },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verify failed" },
      { status: 401 }
    );
  }
}
