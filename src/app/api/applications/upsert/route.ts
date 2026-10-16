import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { upsertMany } from "@/lib/applications";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  date_found: z.string().nullable().optional(),
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string().nullable().optional(),
  listed_pay: z.string().nullable().optional(),
  cv: z.string().nullable().optional(),
  apply_link: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  raw_status: z.string().nullable().optional(),
  status_reason: z.string().nullable().optional(),
  date_applied: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const bodySchema = z.object({
  applications: z.array(itemSchema).min(1).max(1000),
});

export async function POST(req: NextRequest) {
  const access = await requireScopes(req, ["ingest"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = await ensureSchema(getDb());
  const items = parsed.data.applications.map((a) => ({
    ...a,
    id: String(a.id),
  }));
  const result = await upsertMany(db, items);

  return NextResponse.json({
    ok: true,
    created: result.created,
    updated: result.updated,
    total: result.created + result.updated,
  });
}
