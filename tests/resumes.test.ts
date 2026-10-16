import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureSchema, resetDb } from "../src/lib/db";
import {
  createSignedResumeUrl,
  getLatestResume,
  listCurrentResumes,
  storeResume,
  verifySignedResumeUrl,
} from "../src/lib/resumes";
import { toolGetResume, toolListResumes } from "../src/lib/mcp-tools";
import { mintToken } from "../src/lib/tokens";

const tmpPaths: string[] = [];

function minimalPdf(label: string): Buffer {
  // Valid enough PDF magic + minimal body for our isPdfBuffer check
  return Buffer.from(
    `%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${label}\n`,
    "binary"
  );
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
  process.env.INGEST_TOKEN = "ingest-env-token";
  process.env.READ_TOKEN = "read-env-token";
  process.env.APP_URL = "https://deisy.byldr.co";
});

afterEach(() => {
  resetDb();
  for (const p of tmpPaths.splice(0)) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  delete process.env.DATABASE_URL;
  delete process.env.RESUMES_DIR;
  delete process.env.RESUME_URL_SECRET;
  delete process.env.SESSION_SECRET;
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
  delete process.env.APP_URL;
});

function tmpEnv() {
  const root = path.join(
    os.tmpdir(),
    `deisy-resumes-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(root, { recursive: true });
  tmpPaths.push(root);
  const dbFile = path.join(root, "db.sqlite");
  const resumes = path.join(root, "resumes");
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.RESUMES_DIR = resumes;
  resetDb();
  return { root, dbFile, resumes };
}

describe("resume storage", () => {
  it("keeps versions and treats latest per lang as current", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());

    const v1 = await storeResume(db, {
      lang: "en",
      filename: "deisy-en-v1.pdf",
      data: minimalPdf("v1"),
    });
    const v2 = await storeResume(db, {
      lang: "en",
      filename: "deisy-en-v2.pdf",
      data: minimalPdf("v2"),
    });
    await storeResume(db, {
      lang: "es",
      filename: "deisy-es.pdf",
      data: minimalPdf("es"),
    });

    const latestEn = await getLatestResume(db, "en");
    expect(latestEn?.id).toBe(v2.id);
    expect(latestEn?.id).not.toBe(v1.id);

    const current = await listCurrentResumes(db);
    expect(current.map((r) => r.lang)).toEqual(["en", "es"]);
    expect(current.find((r) => r.lang === "en")?.filename).toBe(
      "deisy-en-v2.pdf"
    );
  });

  it("rejects non-PDF and oversized payloads", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await expect(
      storeResume(db, {
        lang: "en",
        filename: "x.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      })
    ).rejects.toThrow(/PDF/i);

    const huge = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(10 * 1024 * 1024 + 1, 0x41),
    ]);
    await expect(
      storeResume(db, {
        lang: "en",
        filename: "huge.pdf",
        data: huge,
      })
    ).rejects.toThrow(/exceeds/i);
  });
});

describe("signed resume URLs", () => {
  it("signs and verifies with SESSION_SECRET fallback", () => {
    tmpEnv();
    const { exp, sig } = createSignedResumeUrl("en");
    expect(verifySignedResumeUrl("en", String(exp), sig).ok).toBe(true);
    expect(verifySignedResumeUrl("es", String(exp), sig).ok).toBe(false);
    expect(verifySignedResumeUrl("en", String(exp - 1), sig).ok).toBe(false);
    expect(verifySignedResumeUrl("en", String(exp), "nope").ok).toBe(false);
  });

  it("rejects expired signatures", () => {
    tmpEnv();
    const exp = Math.floor(Date.now() / 1000) - 10;
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const sig = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(`en:${exp}`)
      .digest("base64url");
    const result = verifySignedResumeUrl("en", String(exp), sig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });
});

describe("resume REST routes", () => {
  it("POST requires ingest; GET requires read; download needs valid sig", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const { plaintext: readTok } = await mintToken(db, {
      name: "reader",
      scopes: ["read"],
    });

    const { POST, GET } = await import("../src/app/api/resumes/route");
    const denied = await POST(
      new NextRequest("http://localhost/api/resumes?lang=en", {
        method: "POST",
        headers: {
          authorization: `Bearer ${readTok}`,
          "content-type": "application/pdf",
        },
        body: new Uint8Array(minimalPdf("x")),
      })
    );
    expect(denied.status).toBe(403);

    const uploaded = await POST(
      new NextRequest("http://localhost/api/resumes?lang=en", {
        method: "POST",
        headers: {
          authorization: "Bearer ingest-env-token",
          "content-type": "application/pdf",
          "x-filename": "cv-en.pdf",
        },
        body: new Uint8Array(minimalPdf("upload")),
      })
    );
    expect(uploaded.status).toBe(200);
    const upJson = await uploaded.json();
    expect(upJson.resume.lang).toBe("en");
    expect(upJson.resume.filename).toBe("cv-en.pdf");

    const listed = await GET(
      new NextRequest("http://localhost/api/resumes", {
        headers: { authorization: `Bearer ${readTok}` },
      })
    );
    expect(listed.status).toBe(200);
    const listJson = await listed.json();
    expect(listJson.count).toBe(1);

    const { GET: download } = await import(
      "../src/app/api/resumes/[lang]/download/route"
    );
    const bad = await download(
      new NextRequest("http://localhost/api/resumes/en/download"),
      { params: Promise.resolve({ lang: "en" }) }
    );
    expect(bad.status).toBe(401);

    const signed = createSignedResumeUrl("en", {
      baseUrl: "http://localhost",
    });
    const ok = await download(
      new NextRequest(signed.signed_url),
      { params: Promise.resolve({ lang: "en" }) }
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    const body = Buffer.from(await ok.arrayBuffer());
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });
});

describe("resume MCP tools", () => {
  it("list_resumes and get_resume return metadata and embedded PDF", async () => {
    tmpEnv();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    await storeResume(db, {
      lang: "es",
      filename: "cv-es.pdf",
      data: minimalPdf("es-cv"),
    });

    const caller = { scopes: ["read"] as const, author: "deisy-bot" };
    const listed = await toolListResumes(db, caller);
    const listPayload = JSON.parse(
      String(
        listed.content.find((c) => c.type === "text" && "text" in c)?.text ??
          "{}"
      )
    );
    expect(listPayload.count).toBe(1);
    expect(listPayload.resumes[0]).toMatchObject({
      lang: "es",
      filename: "cv-es.pdf",
    });
    expect(listPayload.resumes[0].sha256).toBeTruthy();
    expect(listPayload.resumes[0].updated_at).toBeTruthy();

    const got = await toolGetResume(db, caller, { lang: "es" });
    expect("isError" in got && got.isError).toBeFalsy();
    const resource = got.content.find((c) => c.type === "resource");
    expect(resource).toBeTruthy();
    if (resource && resource.type === "resource") {
      expect(resource.resource.mimeType).toBe("application/pdf");
      expect("blob" in resource.resource).toBe(true);
      if ("blob" in resource.resource) {
        const bytes = Buffer.from(resource.resource.blob, "base64");
        expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      }
    }
    const metaText = got.content.find((c) => c.type === "text");
    const meta = JSON.parse(String(metaText && "text" in metaText ? metaText.text : "{}"));
    expect(meta.signed_url).toContain("/api/resumes/es/download?");
    expect(meta.expires_at).toBeTruthy();

    const denied = await toolGetResume(
      db,
      { scopes: ["notes"], author: "x" },
      { lang: "es" }
    );
    expect("isError" in denied && denied.isError).toBe(true);
  });
});
