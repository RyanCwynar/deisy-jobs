import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";
import { dropTask, taskPublicView } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["write"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }
  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const task = await dropTask(db, id);
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
    diff: { status: "dropped" },
  });
  return NextResponse.json({ ok: true, task: taskPublicView(task) });
}
