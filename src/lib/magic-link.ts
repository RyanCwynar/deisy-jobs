/** Default Resend From when RESEND_FROM is unset (sending only). */
export const DEFAULT_RESEND_FROM = "deisy-jobs <noreply@byldr.co>";

export function resolveResendFrom(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  const from = env.RESEND_FROM?.trim();
  if (from) return from;
  return DEFAULT_RESEND_FROM;
}

/** Magic link UI/health: requires both API key and explicit RESEND_FROM. */
export function isMagicLinkConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM?.trim());
}
