import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { publicAbsoluteUrl } from "@/lib/public-origin";

const COOKIE_NAME = "deisy_jobs_session";

const PUBLIC_PATHS = [
  "/login",
  "/api/health",
  "/api/auth/login",
  "/api/auth/magic-link",
  "/api/auth/magic-verify",
  "/mcp",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  // Bearer-token API routes: auth checked in handlers
  if (pathname.startsWith("/api/")) return true;
  return false;
}

function loginRedirect(req: NextRequest, nextPath?: string, error?: string) {
  const login = publicAbsoluteUrl("/login", req);
  if (nextPath) login.searchParams.set("next", nextPath);
  if (error) login.searchParams.set("error", error);
  return NextResponse.redirect(login);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return loginRedirect(req, undefined, "config");
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return loginRedirect(req, pathname);
  }

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return NextResponse.next();
  } catch {
    const res = loginRedirect(req, pathname);
    res.cookies.delete(COOKIE_NAME);
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
