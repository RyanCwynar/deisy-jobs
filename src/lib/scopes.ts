export const API_SCOPES = ["read", "notes", "ingest"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function parseScopes(raw: string | string[]): ApiScope[] {
  const parts = Array.isArray(raw)
    ? raw
    : raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out: ApiScope[] = [];
  for (const p of parts) {
    if ((API_SCOPES as readonly string[]).includes(p) && !out.includes(p as ApiScope)) {
      out.push(p as ApiScope);
    }
  }
  return out;
}

export function scopesToString(scopes: ApiScope[]): string {
  return scopes.join(",");
}

export function hasScope(
  scopes: readonly ApiScope[] | readonly string[],
  needed: ApiScope
): boolean {
  return scopes.includes(needed);
}

export function hasAllScopes(
  scopes: readonly ApiScope[] | readonly string[],
  needed: readonly ApiScope[]
): boolean {
  return needed.every((s) => scopes.includes(s));
}
