import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema, getDb } from "@/lib/db";
import { beginAuthentication } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  let json: unknown = {};
  try {
    const text = await req.text();
    if (text) json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const db = await ensureSchema(getDb());
    const options = await beginAuthentication(
      db,
      { email: parsed.data.email ?? null },
      req
    );
    return NextResponse.json(options);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Options failed" },
      { status: 500 }
    );
  }
}
