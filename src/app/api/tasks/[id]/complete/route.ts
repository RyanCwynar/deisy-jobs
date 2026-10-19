import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";
import { completeTask, taskPublicView } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    note: z.string().optional(),
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
  let note: string | undefined;
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (parsed.success) note = parsed.data?.note;
  } catch {
    /* empty ok */
  }
  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const task = await completeTask(db, id, note);
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
    diff: { status: "done", reply: task.reply },
  });
  return NextResponse.json({ ok: true, task: taskPublicView(task) });
}
