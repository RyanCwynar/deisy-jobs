/**
 * Resolve the public site origin for redirects and absolute links.
 * Safe for Edge (middleware) and Node.
 *
 * Order:
 * 1. x-forwarded-host (+ x-forwarded-proto) when Traefik/proxy sets it
 * 2. Local Host (localhost / 127.0.0.1) — keep local next start working even if APP_URL is set
 * 3. APP_URL / NEXT_PUBLIC_APP_URL / DEISY_JOBS_URL
 * 4. Host header / request URL origin
 * 5. http://127.0.0.1:3010
 */

export type OriginRequestLike = {
  headers: { get(name: string): string | null };
  url?: string;
};

const ENV_KEYS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "DEISY_JOBS_URL"] as const;

function firstHeader(
  headers: { get(name: string): string | null },
  name: string
): string | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1") ||
    h.startsWith("[::1]")
  );
}

function originFromEnvValue(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export function publicOriginFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  for (const key of ENV_KEYS) {
    const v = env[key];
    if (!v) continue;
    const origin = originFromEnvValue(v);
    if (origin) return origin;
  }
  return null;
}

/** Build origin from host + optional proto (defaults http for local, else https). */
export function originFromHostProto(
  host: string,
  proto: string | null | undefined
): string | null {
  const cleanHost = host.trim();
  if (!cleanHost) return null;
  const scheme =
    (proto && proto.trim()) ||
    (isLocalHost(cleanHost) ? "http" : "https");
  try {
    return new URL(`${scheme}://${cleanHost}`).origin;
  } catch {
    return null;
  }
}

export function publicOriginFromForwarded(
  headers: { get(name: string): string | null }
): string | null {
  const xfHost = firstHeader(headers, "x-forwarded-host");
  if (!xfHost) return null;
  const proto = firstHeader(headers, "x-forwarded-proto");
  return originFromHostProto(xfHost, proto);
}

export function resolvePublicOrigin(
  req?: OriginRequestLike | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  if (req?.headers) {
    const forwarded = publicOriginFromForwarded(req.headers);
    if (forwarded) return forwarded;

    const host = firstHeader(req.headers, "host");
    if (host && isLocalHost(host)) {
      const local = originFromHostProto(host, "http");
      if (local) return local;
    }
  }

  const fromEnv = publicOriginFromEnv(env);
  if (fromEnv) return fromEnv;

  if (req?.headers) {
    const host = firstHeader(req.headers, "host");
    if (host) {
      const proto = firstHeader(req.headers, "x-forwarded-proto");
      const fromHost = originFromHostProto(host, proto);
      if (fromHost) return fromHost;
    }
  }

  if (req?.url) {
    try {
      return new URL(req.url).origin;
    } catch {
      /* ignore */
    }
  }

  return "http://127.0.0.1:3010";
}

/** Build an absolute URL on the public origin. */
export function publicAbsoluteUrl(
  pathAndQuery: string,
  req?: OriginRequestLike | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): URL {
  const origin = resolvePublicOrigin(req, env);
  const path = pathAndQuery.startsWith("/")
    ? pathAndQuery
    : `/${pathAndQuery}`;
  return new URL(path, `${origin}/`);
}
