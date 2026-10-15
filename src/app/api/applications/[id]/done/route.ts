import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, hasReadToken } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { markDone } from "@/lib/applications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    done: z.boolean().optional(),
  })
  .optional();

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getSessionFromRequest(req);
  const bearerOk = hasReadToken(req);
  if (!session && !bearerOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const app = await markDone(db, id, done);
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, application: app });
}
