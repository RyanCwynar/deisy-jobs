import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { ensureSchema, getDb } from "./db";
import { hasScope, type ApiScope } from "./scopes";
import { resolveBearerToken, type ResolvedBearer } from "./tokens";

export type SessionUser = {
  email: string;
  name: "deisy" | "ryan";
};

export type AccessPrincipal =
  | { kind: "session"; user: SessionUser; scopes: ApiScope[]; author: string }
  | (ResolvedBearer & { user: null });

const COOKIE_NAME = "deisy_jobs_session";
const MAGIC_COOKIE = "deisy_jobs_magic";

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(secret);
}

function usersFromEnv(): Array<{
  email: string;
  hash: string;
  name: "deisy" | "ryan";
}> {
  const out: Array<{ email: string; hash: string; name: "deisy" | "ryan" }> =
    [];
  if (process.env.DEISY_EMAIL && process.env.DEISY_PASSWORD_HASH) {
    out.push({
      email: process.env.DEISY_EMAIL.toLowerCase(),
      hash: process.env.DEISY_PASSWORD_HASH,
      name: "deisy",
    });
  }
  if (process.env.RYAN_EMAIL && process.env.RYAN_PASSWORD_HASH) {
    out.push({
      email: process.env.RYAN_EMAIL.toLowerCase(),
      hash: process.env.RYAN_PASSWORD_HASH,
      name: "ryan",
    });
  }
  return out;
}

export function findUserByEmail(
  email: string
): { email: string; hash: string; name: "deisy" | "ryan" } | null {
  const e = email.trim().toLowerCase();
  return usersFromEnv().find((u) => u.email === e) ?? null;
}

export async function verifyPassword(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const user = findUserByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return null;
  return { email: user.email, name: user.name };
}

export async function createSessionToken(
  user: SessionUser,
  expiresIn = "14d"
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.email === "string" &&
      (payload.name === "deisy" || payload.name === "ryan")
    ) {
      return { email: payload.email, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function getBearerToken(req: NextRequest | Request): string | null {
  const h =
    req instanceof NextRequest
      ? req.headers.get("authorization")
      : req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

export async function resolveAccess(
  req: NextRequest | Request
): Promise<AccessPrincipal | null> {
  const bearer = getBearerToken(req);
  if (bearer) {
    const db = await ensureSchema(getDb());
    const resolved = await resolveBearerToken(db, bearer);
    if (resolved) return { ...resolved, user: null };
  }

  if (req instanceof NextRequest) {
    const user = await getSessionFromRequest(req);
    if (user) {
      return {
        kind: "session",
        user,
        scopes: ["read", "notes", "write"],
        author: user.name,
      };
    }
  }

  return null;
}

export async function requireScopes(
  req: NextRequest | Request,
  needed: readonly ApiScope[]
): Promise<
  | { ok: true; principal: AccessPrincipal }
  | { ok: false; status: 401 | 403; error: string }
> {
  const principal = await resolveAccess(req);
  if (!principal) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  for (const scope of needed) {
    if (!hasScope(principal.scopes, scope)) {
      return { ok: false, status: 403, error: `Missing scope: ${scope}` };
    }
  }
  return { ok: true, principal };
}

/** @deprecated Prefer requireScopes — kept for existing tests / call sites. */
export function hasIngestToken(req: NextRequest): boolean {
  const token = getBearerToken(req);
  const expected = process.env.INGEST_TOKEN;
  return Boolean(token && expected && token === expected);
}

/** @deprecated Prefer requireScopes — kept for existing tests / call sites. */
export function hasReadToken(req: NextRequest): boolean {
  const token = getBearerToken(req);
  if (!token) return false;
  const read = process.env.READ_TOKEN;
  const ingest = process.env.INGEST_TOKEN;
  return Boolean(
    (read && token === read) || (ingest && token === ingest)
  );
}

/** Session cookie or bearer with read scope. */
export async function requireReadAccess(
  req: NextRequest
): Promise<
  | { ok: true; user: SessionUser | null; principal: AccessPrincipal }
  | { ok: false }
> {
  const access = await requireScopes(req, ["read"]);
  if (!access.ok) return { ok: false };
  return {
    ok: true,
    user: access.principal.kind === "session" ? access.principal.user : null,
    principal: access.principal,
  };
}

export async function createMagicToken(email: string): Promise<string> {
  const user = findUserByEmail(email);
  if (!user) throw new Error("Unknown email");
  return new SignJWT({ email: user.email, name: user.name, purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secretKey());
}

export async function verifyMagicToken(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.purpose !== "magic") return null;
    if (
      typeof payload.email === "string" &&
      (payload.name === "deisy" || payload.name === "ryan")
    ) {
      return { email: payload.email, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAGIC_COOKIE };
