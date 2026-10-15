import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import {
  createSessionToken,
  hasIngestToken,
  hasReadToken,
  verifyPassword,
  verifySessionToken,
} from "../src/lib/auth";

const SECRET = "test-session-secret-32chars!!";
const INGEST = "ingest-token-test";
const READ = "read-token-test";

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.INGEST_TOKEN = INGEST;
  process.env.READ_TOKEN = READ;
  process.env.DEISY_EMAIL = "deisy@example.com";
  process.env.DEISY_PASSWORD_HASH = bcrypt.hashSync("deisy-pass", 4);
  process.env.RYAN_EMAIL = "ryan@example.com";
  process.env.RYAN_PASSWORD_HASH = bcrypt.hashSync("ryan-pass", 4);
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.INGEST_TOKEN;
  delete process.env.READ_TOKEN;
  delete process.env.DEISY_EMAIL;
  delete process.env.DEISY_PASSWORD_HASH;
  delete process.env.RYAN_EMAIL;
  delete process.env.RYAN_PASSWORD_HASH;
});

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe("API bearer auth", () => {
  it("accepts INGEST_TOKEN for ingest", () => {
    expect(
      hasIngestToken(req("http://localhost/api/applications/upsert", {
        authorization: `Bearer ${INGEST}`,
      }))
    ).toBe(true);
    expect(
      hasIngestToken(req("http://localhost/api/applications/upsert", {
        authorization: `Bearer wrong`,
      }))
    ).toBe(false);
    expect(hasIngestToken(req("http://localhost/api/applications/upsert"))).toBe(
      false
    );
  });

  it("accepts READ_TOKEN or INGEST_TOKEN for reads", () => {
    expect(
      hasReadToken(
        req("http://localhost/api/applications", {
          authorization: `Bearer ${READ}`,
        })
      )
    ).toBe(true);
    expect(
      hasReadToken(
        req("http://localhost/api/applications", {
          authorization: `Bearer ${INGEST}`,
        })
      )
    ).toBe(true);
    expect(
      hasReadToken(
        req("http://localhost/api/applications", {
          authorization: `Bearer nope`,
        })
      )
    ).toBe(false);
  });
});

describe("password + session", () => {
  it("verifies deisy and ryan passwords", async () => {
    const d = await verifyPassword("deisy@example.com", "deisy-pass");
    expect(d?.name).toBe("deisy");
    const r = await verifyPassword("ryan@example.com", "ryan-pass");
    expect(r?.name).toBe("ryan");
    expect(await verifyPassword("deisy@example.com", "wrong")).toBeNull();
  });

  it("signs and verifies session tokens", async () => {
    const token = await createSessionToken({
      email: "deisy@example.com",
      name: "deisy",
    });
    const user = await verifySessionToken(token);
    expect(user).toEqual({ email: "deisy@example.com", name: "deisy" });
    expect(await verifySessionToken("garbage")).toBeNull();
  });
});

describe("upsert route auth gate", () => {
  it("rejects missing bearer on upsert handler", async () => {
    const { POST } = await import("../src/app/api/applications/upsert/route");
    const res = await POST(
      req("http://localhost/api/applications/upsert", {
        "content-type": "application/json",
      })
    );
    // NextRequest without body - still unauthorized first
    expect(res.status).toBe(401);
  });

  it("rejects missing bearer on list handler", async () => {
    const { GET } = await import("../src/app/api/applications/route");
    const res = await GET(req("http://localhost/api/applications"));
    expect(res.status).toBe(401);
  });

  it("allows health without auth", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `deisy-health-${Date.now()}.db`)}`;
    const { resetDb } = await import("../src/lib/db");
    resetDb();
    const { GET } = await import("../src/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
