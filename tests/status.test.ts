import { describe, expect, it } from "vitest";
import { normalizeCv, normalizeStatus } from "../src/lib/status";

describe("normalizeStatus", () => {
  it("parses parenthetical reason", () => {
    const r = normalizeStatus("Skipped (not eligible)");
    expect(r.status).toBe("Skipped");
    expect(r.status_reason).toBe("not eligible");
    expect(r.raw_status).toBe("Skipped (not eligible)");
  });

  it("parses colon reason", () => {
    const r = normalizeStatus("Parked: needs JSON-LD sample");
    expect(r.status).toBe("Parked");
    expect(r.status_reason).toBe("needs JSON-LD sample");
  });

  it("maps Needs Deisy to Needs-Deisy", () => {
    const a = normalizeStatus("Needs Deisy: CBRE account");
    expect(a.status).toBe("Needs-Deisy");
    expect(a.status_reason).toBe("CBRE account");

    const b = normalizeStatus("Needs-Deisy: Cloudflare check");
    expect(b.status).toBe("Needs-Deisy");
  });

  it("keeps Closed with em-dash reason", () => {
    const r = normalizeStatus("Closed — Ashby posting removed");
    expect(r.status).toBe("Closed");
    expect(r.status_reason).toBe("Ashby posting removed");
  });

  it("handles bare status", () => {
    const r = normalizeStatus("Submitted");
    expect(r.status).toBe("Submitted");
    expect(r.status_reason).toBeNull();
  });
});

describe("normalizeCv", () => {
  it("normalizes language codes", () => {
    expect(normalizeCv("EN")).toBe("EN");
    expect(normalizeCv("ES")).toBe("ES");
    expect(normalizeCv("ES/EN")).toBe("ES/EN");
    expect(normalizeCv("EN (LinkedIn profile)")).toBe("EN");
  });
});
