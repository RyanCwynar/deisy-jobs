import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { createMagicToken, findUserByEmail } from "@/lib/auth";
import {
  isMagicLinkConfigured,
  resolveResendFrom,
} from "@/lib/magic-link";
import { resolvePublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  if (!isMagicLinkConfigured()) {
    return NextResponse.json(
      { error: "Magic link not configured" },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const user = findUserByEmail(parsed.data.email);
  // Always return ok to avoid email enumeration
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  try {
    const token = await createMagicToken(user.email);
    const base = resolvePublicOrigin(req);
    const link = `${base}/api/auth/magic-verify?token=${encodeURIComponent(token)}`;

    const resend = new Resend(process.env.RESEND_API_KEY!);
    const from = resolveResendFrom();
    await resend.emails.send({
      from,
      to: user.email,
      subject: "deisy-jobs magic link",
      text: `Sign in: ${link}\n\nExpires in 15 minutes.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
