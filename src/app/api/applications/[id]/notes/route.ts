import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { addNote, getApplication } from "@/lib/applications";
import { actorFromPrincipal, recordChange } from "@/lib/changelog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  body: z.string().min(1).max(8000),
  author: z.string().min(1).max(64).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const access = await requireScopes(req, ["notes"]);
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
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // DB tokens always attribute notes to the token name (e.g. deisy-bot).
  // Sessions may override; env tokens default to "bot".
  let author = access.principal.author;
  if (access.principal.kind === "session" && parsed.data.author) {
    author = parsed.data.author;
  } else if (access.principal.kind === "env" && parsed.data.author) {
    author = parsed.data.author;
  }

  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const app = await getApplication(db, id);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const note = await addNote(db, id, author, parsed.data.body);
  const audit = actorFromPrincipal(access.principal);
  await recordChange(db, {
    actor: audit.actor,
    token_id: audit.token_id,
    entity: "note",
    entity_id: String(note.id),
    action: "create",
    diff: {
      application_id: note.application_id,
      author: note.author,
      body: note.body,
    },
  });
  return NextResponse.json({ ok: true, note });
}
