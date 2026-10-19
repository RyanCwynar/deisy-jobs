import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RESEND_FROM,
  isMagicLinkConfigured,
  resolveResendFrom,
} from "../src/lib/magic-link";

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe("magic-link config", () => {
  it("resolveResendFrom prefers RESEND_FROM then default constant", () => {
    expect(resolveResendFrom({})).toBe(DEFAULT_RESEND_FROM);
    expect(
      resolveResendFrom({ RESEND_FROM: "  Deisy <jobs@byldr.co>  " })
    ).toBe("Deisy <jobs@byldr.co>");
  });

  it("isMagicLinkConfigured requires both key and from", () => {
    expect(isMagicLinkConfigured({})).toBe(false);
    expect(
      isMagicLinkConfigured({ RESEND_API_KEY: "re_test" })
    ).toBe(false);
    expect(
      isMagicLinkConfigured({ RESEND_FROM: "x@y.co" })
    ).toBe(false);
    expect(
      isMagicLinkConfigured({
        RESEND_API_KEY: "re_test",
        RESEND_FROM: "deisy-jobs <noreply@byldr.co>",
      })
    ).toBe(true);
    expect(
      isMagicLinkConfigured({
        RESEND_API_KEY: "  ",
        RESEND_FROM: "x@y.co",
      })
    ).toBe(false);
  });
});
