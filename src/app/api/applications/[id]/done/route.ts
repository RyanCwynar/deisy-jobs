import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { getApplication, markDone } from "@/lib/applications";
import { actorFromPrincipal, diffFields, recordChange } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    done: z.boolean().optional(),
  })
  .optional();

export async function POST(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["notes"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  let done = true;
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (parsed.success && typeof parsed.data?.done === "boolean") {
      done = parsed.data.done;
    }
  } catch {
    /* empty body ok */
  }

  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const before = await getApplication(db, id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const app = await markDone(db, id, done);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const audit = actorFromPrincipal(access.principal);
  await recordChange(db, {
    actor: audit.actor,
    token_id: audit.token_id,
    entity: "application",
    entity_id: app.id,
    action: "update",
    diff: {
      fields: diffFields(
        { done_at: before.done_at },
        { done_at: app.done_at }
      ),
    },
  });
  return NextResponse.json({ ok: true, application: app });
}
