import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyMagicToken } from "@/lib/auth";
import { publicAbsoluteUrl } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(
      publicAbsoluteUrl("/login?error=missing", req)
    );
  }

  const user = await verifyMagicToken(token);
  if (!user) {
    return NextResponse.redirect(
      publicAbsoluteUrl("/login?error=invalid", req)
    );
  }

  await setSessionCookie(user);
  return NextResponse.redirect(publicAbsoluteUrl("/", req));
}
