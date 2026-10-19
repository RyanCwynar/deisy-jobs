import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";
import { ensureSchema, getDb } from "@/lib/db";
import {
  createTask,
  listTasks,
  parseTaskKind,
  parseTaskStatus,
  taskPublicView,
  TASK_KINDS,
} from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }
  const statusRaw = req.nextUrl.searchParams.get("status");
  const status = statusRaw ? parseTaskStatus(statusRaw) : undefined;
  if (statusRaw && !status) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const db = await ensureSchema(getDb());
  const tasks = await listTasks(db, {
    status: status ?? undefined,
    application_id: req.nextUrl.searchParams.get("application_id") ?? undefined,
  });
  return NextResponse.json({
    tasks: tasks.map(taskPublicView),
    count: tasks.length,
  });
}

const createSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  kind: z.enum(TASK_KINDS as unknown as [string, ...string[]]),
  application_ids: z.array(z.string()).min(1),
  priority: z.number().int().optional(),
  due_date: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
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
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const kind = parseTaskKind(parsed.data.kind);
  if (!kind) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  try {
    const db = await ensureSchema(getDb());
    const audit = actorFromPrincipal(access.principal);
    const task = await createTask(db, {
      ...parsed.data,
      kind,
      created_by: audit.actor,
    });
    await recordChange(db, {
      actor: audit.actor,
      token_id: audit.token_id,
      entity: "task",
      entity_id: task.id,
      action: "create",
      diff: {
        title: task.title,
        kind: task.kind,
        application_ids: task.application_ids,
      },
    });
    return NextResponse.json({ ok: true, task: taskPublicView(task) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 400 }
    );
  }
}
