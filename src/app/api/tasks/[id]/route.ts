import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";
import {
  getTaskWithApps,
  parseTaskKind,
  TASK_KINDS,
  taskPublicView,
  updateTask,
} from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }
  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const task = await getTaskWithApps(db, id);
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ task: taskPublicView(task) });
}

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  detail: z.string().optional(),
  priority: z.number().int().optional(),
  due_date: z.string().nullable().optional(),
  kind: z.enum(TASK_KINDS as unknown as [string, ...string[]]).optional(),
  application_ids: z.array(z.string()).min(1).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["write"]);
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
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const kind =
    parsed.data.kind !== undefined ? parseTaskKind(parsed.data.kind) : undefined;
  if (parsed.data.kind !== undefined && !kind) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const db = await ensureSchema(getDb());
    const task = await updateTask(db, id, { ...parsed.data, kind: kind ?? undefined });
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
      diff: parsed.data as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true, task: taskPublicView(task) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}
