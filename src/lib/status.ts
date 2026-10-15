export const STATUS_PREFIXES = [
  "Skipped",
  "Parked",
  "Submitted",
  "Needs-Deisy",
  "Closed",
  "Found",
] as const;

export type StatusPrefix = (typeof STATUS_PREFIXES)[number];

export type ParsedStatus = {
  status: StatusPrefix;
  status_reason: string | null;
  raw_status: string;
};

const PREFIX_ALIASES: Record<string, StatusPrefix> = {
  skipped: "Skipped",
  parked: "Parked",
  submitted: "Submitted",
  "needs-deisy": "Needs-Deisy",
  "needs deisy": "Needs-Deisy",
  closed: "Closed",
  found: "Found",
};

/** Normalize free-text status to prefix + reason; keep raw_status. */
export function normalizeStatus(raw: string | null | undefined): ParsedStatus {
  const raw_status = (raw ?? "").trim();
  if (!raw_status) {
    return { status: "Found", status_reason: null, raw_status: "" };
  }

  // Match known prefix (including "Needs Deisy" ↔ "Needs-Deisy")
  const lower = raw_status.toLowerCase();
  let matched: StatusPrefix | null = null;
  let matchedLen = 0;

  for (const [alias, prefix] of Object.entries(PREFIX_ALIASES)) {
    if (lower === alias || lower.startsWith(alias + ":") || lower.startsWith(alias + " ") || lower.startsWith(alias + "(") || lower.startsWith(alias + "—") || lower.startsWith(alias + "–") || lower.startsWith(alias + "-")) {
      if (alias.length >= matchedLen) {
        matched = prefix;
        matchedLen = alias.length;
      }
    }
  }

  // Prefer exact canonical hyphenated Needs-Deisy over shorter matches
  if (lower.startsWith("needs-deisy") || lower.startsWith("needs deisy")) {
    matched = "Needs-Deisy";
    matchedLen = lower.startsWith("needs-deisy") ? "needs-deisy".length : "needs deisy".length;
  }

  const status: StatusPrefix = matched ?? "Found";

  let status_reason: string | null = null;

  // Reason after colon
  const colonIdx = raw_status.indexOf(":");
  if (colonIdx !== -1) {
    status_reason = raw_status.slice(colonIdx + 1).trim() || null;
  } else {
    // Reason in parentheses
    const parenMatch = raw_status.match(/\(([^)]*)\)\s*$/);
    if (parenMatch) {
      status_reason = parenMatch[1].trim() || null;
    } else {
      // Em/en dash after prefix (e.g. "Closed — Ashby…")
      const dashMatch = raw_status.match(/^(?:Needs[-\s]Deisy|Skipped|Parked|Submitted|Closed|Found)\s*[—–-]\s*(.+)$/i);
      if (dashMatch) {
        status_reason = dashMatch[1].trim() || null;
      }
    }
  }

  return { status, status_reason, raw_status };
}

/** Normalize CV column to EN / ES / ES/EN. */
export function normalizeCv(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return "EN";
  if (v.includes("ES") && v.includes("EN")) return "ES/EN";
  if (v.startsWith("ES")) return "ES";
  return "EN";
}

export function isNeedsDeisy(status: string): boolean {
  return status === "Needs-Deisy";
}
