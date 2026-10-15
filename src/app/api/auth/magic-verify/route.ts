import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyMagicToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing", req.url));
  }

  const user = await verifyMagicToken(token);
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=invalid", req.url));
  }

  await setSessionCookie(user);
  return NextResponse.redirect(new URL("/", req.url));
}
