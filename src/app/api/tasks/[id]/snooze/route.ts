import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";
import { snoozeTask, taskPublicView } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    until: z.string().optional(),
    days: z.number().positive().optional(),
  })
  .optional();

export async function POST(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["write"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }
  let until: string | undefined;
  let days: number | undefined;
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (parsed.success) {
      until = parsed.data?.until;
      days = parsed.data?.days;
    }
  } catch {
    /* empty ok */
  }
  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const task = await snoozeTask(db, id, { until, days });
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const audit = actorFromPrincipal(access.principal);
  await recordChange(db, {
    actor: audit.actor,
    token_id: audit.token_id,
    entity: "task",
    entity_id: task.id,
    action: "update",
    diff: { status: "snoozed", snoozed_until: task.snoozed_until },
  });
  return NextResponse.json({ ok: true, task: taskPublicView(task) });
}
