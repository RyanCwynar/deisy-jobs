import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, hasReadToken } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { addNote, getApplication } from "@/lib/applications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  body: z.string().min(1).max(8000),
  author: z.enum(["deisy", "ryan", "bot"]).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getSessionFromRequest(req);
  const bearerOk = hasReadToken(req);
  if (!session && !bearerOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const author =
    parsed.data.author ??
    (session?.name === "deisy" || session?.name === "ryan"
      ? session.name
      : "bot");

  const { id } = await ctx.params;
  const db = await ensureSchema(getDb());
  const app = await getApplication(db, id);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const note = await addNote(db, id, author, parsed.data.body);
  return NextResponse.json({ ok: true, note });
}
