import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import {
  getLatestResume,
  parseResumeLang,
  readResumeBytes,
  verifySignedResumeUrl,
} from "@/lib/resumes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ lang: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { lang: langParam } = await ctx.params;
  const lang = parseResumeLang(langParam);
  if (!lang) {
    return NextResponse.json({ error: "lang must be en or es" }, { status: 400 });
  }

  const verified = verifySignedResumeUrl(
    lang,
    req.nextUrl.searchParams.get("exp"),
    req.nextUrl.searchParams.get("sig")
  );
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 401 });
  }

  const db = await ensureSchema(getDb());
  const resume = await getLatestResume(db, lang);
  if (!resume) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = readResumeBytes(resume);
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": resume.content_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${resume.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Resume-Sha256": resume.sha256,
    },
  });
}
