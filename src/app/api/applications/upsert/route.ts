import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { getApplication, upsertApplication } from "@/lib/applications";
import { actorFromPrincipal, diffFields, recordChange } from "@/lib/changelog";

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
  const audit = actorFromPrincipal(access.principal);
  let created = 0;
  let updated = 0;

  for (const item of parsed.data.applications) {
    const id = String(item.id);
    const beforeRow = await getApplication(db, id);
    const before = beforeRow
      ? {
          company: beforeRow.company,
          role: beforeRow.role,
          status: beforeRow.status,
          status_reason: beforeRow.status_reason,
          date_applied: beforeRow.date_applied,
          notes: beforeRow.notes,
          cv: beforeRow.cv,
          location: beforeRow.location,
          listed_pay: beforeRow.listed_pay,
          apply_link: beforeRow.apply_link,
          date_found: beforeRow.date_found,
        }
      : null;
    const result = await upsertApplication(db, { ...item, id });
    const afterRow = await getApplication(db, result.id);
    const after = afterRow
      ? {
          company: afterRow.company,
          role: afterRow.role,
          status: afterRow.status,
          status_reason: afterRow.status_reason,
          date_applied: afterRow.date_applied,
          notes: afterRow.notes,
          cv: afterRow.cv,
          location: afterRow.location,
          listed_pay: afterRow.listed_pay,
          apply_link: afterRow.apply_link,
          date_found: afterRow.date_found,
        }
      : {};
    await recordChange(db, {
      actor: audit.actor,
      token_id: audit.token_id,
      entity: "application",
      entity_id: result.id,
      action: result.created ? "create" : "update",
      diff: { fields: diffFields(before, after) },
    });
    if (result.created) created += 1;
    else updated += 1;
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    total: created + updated,
  });
}
