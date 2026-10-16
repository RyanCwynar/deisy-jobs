import { NextRequest, NextResponse } from "next/server";
import { requireScopes } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import {
  listResumes,
  MAX_RESUME_BYTES,
  parseResumeLang,
  resumePublicMeta,
  storeResume,
} from "@/lib/resumes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const db = await ensureSchema(getDb());
  const resumes = await listResumes(db);
  return NextResponse.json({
    resumes: resumes.map(resumePublicMeta),
    count: resumes.length,
  });
}

async function readUpload(req: NextRequest): Promise<
  | { ok: true; lang: "en" | "es"; filename: string; contentType: string; data: Buffer }
  | { ok: false; status: number; error: string }
> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { ok: false, status: 400, error: "Invalid multipart body" };
    }
    const lang = parseResumeLang(
      typeof form.get("lang") === "string" ? String(form.get("lang")) : null
    );
    if (!lang) {
      return { ok: false, status: 400, error: "lang must be en or es" };
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return { ok: false, status: 400, error: "multipart field file is required" };
    }
    if (file.size > MAX_RESUME_BYTES) {
      return { ok: false, status: 413, error: "PDF exceeds 10MB" };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    return {
      ok: true,
      lang,
      filename: file.name || `resume-${lang}.pdf`,
      contentType: file.type || "application/pdf",
      data: buf,
    };
  }

  // Raw PDF body with ?lang=
  const lang = parseResumeLang(req.nextUrl.searchParams.get("lang"));
  if (!lang) {
    return {
      ok: false,
      status: 400,
      error: "lang query param (en|es) required for raw PDF body",
    };
  }
  const ab = await req.arrayBuffer();
  const data = Buffer.from(ab);
  if (data.length > MAX_RESUME_BYTES) {
    return { ok: false, status: 413, error: "PDF exceeds 10MB" };
  }
  const filename =
    req.headers.get("x-filename")?.trim() || `resume-${lang}.pdf`;
  return {
    ok: true,
    lang,
    filename,
    contentType: contentType || "application/pdf",
    data,
  };
}

export async function POST(req: NextRequest) {
  const access = await requireScopes(req, ["ingest"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    );
  }

  const uploaded = await readUpload(req);
  if (!uploaded.ok) {
    return NextResponse.json(
      { error: uploaded.error },
      { status: uploaded.status }
    );
  }

  try {
    const db = await ensureSchema(getDb());
    const resume = await storeResume(db, {
      lang: uploaded.lang,
      filename: uploaded.filename,
      contentType: uploaded.contentType,
      data: uploaded.data,
    });
    return NextResponse.json({ ok: true, resume: resumePublicMeta(resume) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = /Only PDF|Empty/.test(message)
      ? 400
      : /exceeds/.test(message)
        ? 413
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
