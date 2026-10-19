import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { isMagicLinkConfigured } from "@/lib/magic-link";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await ensureSchema(getDb());
    const r = await db.execute(`SELECT COUNT(*) AS c FROM applications`);
    const count = Number(r.rows[0]?.c ?? 0);
    return NextResponse.json({
      ok: true,
      service: "deisy-jobs",
      applications: count,
      magic_link: isMagicLinkConfigured(),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "health failed",
      },
      { status: 500 }
    );
  }
}
