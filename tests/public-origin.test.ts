import { afterEach, describe, expect, it } from "vitest";
import {
  publicAbsoluteUrl,
  publicOriginFromEnv,
  publicOriginFromForwarded,
  resolvePublicOrigin,
} from "../src/lib/public-origin";

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.DEISY_JOBS_URL;
});

function headers(map: Record<string, string>) {
  return {
    get(name: string) {
      return map[name.toLowerCase()] ?? map[name] ?? null;
    },
  };
}

describe("publicOriginFromForwarded", () => {
  it("uses x-forwarded-host and x-forwarded-proto (Traefik)", () => {
    expect(
      publicOriginFromForwarded(
        headers({
          "x-forwarded-host": "deisy.byldr.co",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://deisy.byldr.co");
  });

  it("takes the first value of comma-separated forwarded headers", () => {
    expect(
      publicOriginFromForwarded(
        headers({
          "x-forwarded-host": "deisy.byldr.co, internal.local",
          "x-forwarded-proto": "https, http",
        })
      )
    ).toBe("https://deisy.byldr.co");
  });

  it("returns null when x-forwarded-host is absent", () => {
    expect(
      publicOriginFromForwarded(headers({ host: "localhost:3010" }))
    ).toBeNull();
  });
});

describe("publicOriginFromEnv", () => {
  it("reads APP_URL, NEXT_PUBLIC_APP_URL, then DEISY_JOBS_URL", () => {
    expect(publicOriginFromEnv({})).toBeNull();
    expect(
      publicOriginFromEnv({ APP_URL: "https://deisy.byldr.co/" })
    ).toBe("https://deisy.byldr.co");
    expect(
      publicOriginFromEnv({
        NEXT_PUBLIC_APP_URL: "https://jobs.byldr.co",
      })
    ).toBe("https://jobs.byldr.co");
    expect(
      publicOriginFromEnv({ DEISY_JOBS_URL: "https://example.test" })
    ).toBe("https://example.test");
  });
});

describe("resolvePublicOrigin", () => {
  it("prefers Traefik forwarded host over APP_URL", () => {
    const origin = resolvePublicOrigin(
      {
        headers: headers({
          host: "127.0.0.1:3010",
          "x-forwarded-host": "deisy.byldr.co",
          "x-forwarded-proto": "https",
        }),
        url: "http://127.0.0.1:3010/todos",
      },
      { APP_URL: "https://wrong.example" }
    );
    expect(origin).toBe("https://deisy.byldr.co");
  });

  it("keeps localhost for local next start even when APP_URL is set", () => {
    const origin = resolvePublicOrigin(
      {
        headers: headers({ host: "localhost:3010" }),
        url: "http://localhost:3010/todos",
      },
      { APP_URL: "https://deisy.byldr.co" }
    );
    expect(origin).toBe("http://localhost:3010");
  });

  it("falls back to APP_URL when no useful request host", () => {
    const origin = resolvePublicOrigin(null, {
      APP_URL: "https://deisy.byldr.co",
    });
    expect(origin).toBe("https://deisy.byldr.co");
  });

  it("falls back to request URL origin, then 127.0.0.1:3010", () => {
    expect(
      resolvePublicOrigin(
        {
          headers: headers({}),
          url: "http://192.168.1.5:3010/login",
        },
        {}
      )
    ).toBe("http://192.168.1.5:3010");

    expect(resolvePublicOrigin(null, {})).toBe("http://127.0.0.1:3010");
  });

  it("builds login redirect URLs on the public origin", () => {
    const url = publicAbsoluteUrl(
      "/login?next=%2Ftodos",
      {
        headers: headers({
          "x-forwarded-host": "deisy.byldr.co",
          "x-forwarded-proto": "https",
        }),
        url: "http://127.0.0.1:3010/todos",
      },
      {}
    );
    expect(url.href).toBe("https://deisy.byldr.co/login?next=%2Ftodos");
    expect(url.origin).not.toContain("localhost");
  });
});
