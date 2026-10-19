import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { deleteCredential } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const db = await ensureSchema(getDb());
    const ok = await deleteCredential(db, {
      id,
      userEmail: session.email,
    });
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
