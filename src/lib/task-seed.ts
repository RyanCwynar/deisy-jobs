import type { Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { listApplications } from "./applications";
import { ensureSchema, type ApplicationRow } from "./db";
import {
  createTask,
  findTaskBySeedKey,
  setTaskApplications,
  type TaskKind,
  updateTask,
} from "./tasks";

export type SeedTaskGroup = {
  seed_key: string;
  title: string;
  detail: string;
  kind: TaskKind;
  application_ids: string[];
  apps: ApplicationRow[];
};

/** Strip Needs-Deisy prefix / parens to get the ask text. */
export function extractAsk(app: ApplicationRow): string {
  const raw = (app.raw_status || app.status || "").trim();
  let ask = raw.replace(/^needs[-\s]?deisy\s*/i, "").trim();
  ask = ask.replace(/^[:\-–—]\s*/, "").trim();
  if (ask.startsWith("(") && ask.endsWith(")")) {
    ask = ask.slice(1, -1).trim();
  }
  // Prefer status_reason when status was normalized to bare Needs-Deisy
  if (!ask && app.status_reason) ask = app.status_reason.trim();
  if (!ask && app.notes) {
    const noteAsk = app.notes.split("|")[0]?.trim() ?? "";
    ask = noteAsk.slice(0, 180);
  }
  if (!ask) ask = `Finish the apply step for ${app.company} — ${app.role}`;
  return ask;
}

function collapseWs(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Canonical seed key for deduping identical asks across apps. */
export function normalizeAskKey(ask: string): string {
  const s = collapseWs(ask);

  if (/bairesdev|applicants\.bairesdev/.test(s) && /cloudflare|cf check|human check/.test(s)) {
    return "ask:bairesdev-cloudflare";
  }
  if (/getonbrd|get on board/.test(s) && /account|login|oauth/.test(s)) {
    return "ask:getonbrd-account";
  }
  if (/loom/.test(s) && /video/.test(s)) return "ask:loom-video";
  if (/video/.test(s) && /required|submission/.test(s)) {
    return "ask:video-submission";
  }
  if (/greenhouse captcha|mygreenhouse/.test(s)) {
    if (/sign-?in|login/.test(s)) return "ask:mygreenhouse-signin";
    return "ask:greenhouse-captcha";
  }
  if (/hcaptcha/.test(s)) return "ask:hcaptcha";
  if (/lever captcha/.test(s)) {
    if (/live exercise/.test(s)) return "ask:lever-captcha-exercise";
    if (/mexico/.test(s)) return "ask:lever-captcha-mexico";
    if (/pay/.test(s)) return "ask:lever-captcha-pay";
    return "ask:lever-captcha";
  }
  if (/cloudflare/.test(s)) return "ask:cloudflare-challenge";
  if (/linkedin external apply/.test(s)) return "ask:linkedin-external-apply";
  if (/internet-?speed screenshot/.test(s)) return "ask:internet-speed-screenshot";
  if (/own-words essays|essays \+ salary|essay/.test(s) && /salary|high-school|degree/.test(s)) {
    if (/salary/.test(s) && /essay/.test(s)) return "ask:essays-and-salary";
    return "ask:essays-results";
  }
  if (/current annual salary/.test(s)) return "ask:annual-salary-usd";
  if (/ashby resume upload/.test(s)) return "ask:ashby-resume-upload";

  // Generic: hash of cleaned ask (stable across identical wording)
  const cleaned = s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `ask:${createHash("sha256").update(cleaned).digest("hex").slice(0, 24)}`;
}

export function inferKind(ask: string): TaskKind {
  const s = ask.toLowerCase();
  if (/loom|video/.test(s)) return "video";
  if (/audio|voice note|1-?min.*intro|spoken/.test(s)) return "audio";
  if (/photo|selfie|headshot|picture/.test(s)) return "photo";
  if (/essay|written answer|own-words|cover letter question/.test(s)) return "essay";
  if (/assessment|test|quiz|exercise|live exercise/.test(s)) return "assessment";
  if (/interview|call|screen/.test(s) && !/screenshot/.test(s)) return "interview";
  if (/upload|screenshot|attach|cv upload|resume upload/.test(s)) return "upload";
  if (/account|sign-?in|login|register|oauth/.test(s)) return "account";
  if (/captcha|cloudflare|hcaptcha|human check|cf check/.test(s)) return "answer";
  if (/salary|answer|confirm|email apply|instructions/.test(s)) return "answer";
  return "other";
}

/** Plain-language title + detail of exactly what Deisy must do. */
export function plainLanguageTask(
  ask: string,
  apps: ApplicationRow[]
): { title: string; detail: string } {
  const s = ask.trim();
  const companies = [...new Set(apps.map((a) => a.company))];
  const companyList =
    companies.length <= 3
      ? companies.join(", ")
      : `${companies.slice(0, 2).join(", ")} (+${companies.length - 2} more)`;

  let title = s;
  // Make imperative / plain
  if (/^cloudflare/i.test(s) || /human check/i.test(s)) {
    title = `Pass the human check: ${s.replace(/^needs[-\s]?deisy[:\s]*/i, "")}`;
  } else if (/video/i.test(s)) {
    title = `Record/submit the required video (${s})`;
  } else if (/account|sign-?in|login|register/i.test(s)) {
    title = `Create or sign in to the account needed: ${s}`;
  } else if (/captcha/i.test(s)) {
    title = `Solve the captcha and finish apply: ${s}`;
  } else if (/essay/i.test(s)) {
    title = `Write the application essays: ${s}`;
  } else if (/salary/i.test(s)) {
    title = `Provide the salary answer they ask for: ${s}`;
  } else if (/screenshot|upload/i.test(s)) {
    title = `Upload what they ask for: ${s}`;
  } else if (!/^(pass|record|create|solve|write|provide|upload|finish|complete|do )/i.test(s)) {
    title = `Do this to unblock applications: ${s}`;
  }

  // Keep titles readable
  if (title.length > 140) title = title.slice(0, 137) + "…";

  const roles = apps
    .map((a) => `#${a.id} ${a.company} — ${a.role}`)
    .slice(0, 12);
  const detail = [
    `What to do: ${s}`,
    `This unblocks ${apps.length} application(s) at ${companyList}:`,
    ...roles.map((r) => `• ${r}`),
    apps.length > 12 ? `• …and ${apps.length - 12} more` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { title, detail };
}

export function groupNeedsDeisyIntoTasks(
  apps: ApplicationRow[]
): SeedTaskGroup[] {
  const open = apps.filter((a) => a.status === "Needs-Deisy" && !a.done_at);
  const groups = new Map<string, ApplicationRow[]>();
  for (const app of open) {
    const ask = extractAsk(app);
    const key = normalizeAskKey(ask);
    const list = groups.get(key) ?? [];
    list.push(app);
    groups.set(key, list);
  }

  const out: SeedTaskGroup[] = [];
  for (const [key, groupApps] of groups) {
    // Use the shortest ask as representative wording
    const asks = groupApps.map(extractAsk).sort((a, b) => a.length - b.length);
    const ask = asks[0]!;
    const { title, detail } = plainLanguageTask(ask, groupApps);
    const kind = inferKind(ask);
    // seed_key is ask-canonical only (not app set) so re-running merges new apps into same task
    const seed_key = key;
    out.push({
      seed_key,
      title,
      detail,
      kind,
      application_ids: groupApps.map((a) => a.id),
      apps: groupApps,
    });
  }
  return out;
}

export type SeedTasksResult = {
  created: number;
  updated: number;
  unchanged: number;
  groups: number;
  task_ids: string[];
};

/**
 * Idempotent seed: one task per distinct Needs-Deisy blocker ask.
 * Re-running merges newly linked apps into existing seed_key tasks; never duplicates.
 */
export async function seedTasksFromNeedsDeisy(
  db: Client,
  opts?: { created_by?: string }
): Promise<SeedTasksResult> {
  await ensureSchema(db);
  const apps = await listApplications(db, { status: "Needs-Deisy" });
  const groups = groupNeedsDeisyIntoTasks(apps);
  const created_by = opts?.created_by ?? "seed";
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const task_ids: string[] = [];

  for (const g of groups) {
    const existing = await findTaskBySeedKey(db, g.seed_key);
    if (!existing) {
      const task = await createTask(db, {
        title: g.title,
        detail: g.detail,
        kind: g.kind,
        application_ids: g.application_ids,
        created_by,
        seed_key: g.seed_key,
        priority: g.application_ids.length,
      });
      task_ids.push(task.id);
      created += 1;
      continue;
    }

    // Merge application links; refresh title/detail if still open/snoozed
    const beforeLinks = (
      await db.execute({
        sql: `SELECT application_id FROM task_applications WHERE task_id = ? ORDER BY application_id`,
        args: [existing.id],
      })
    ).rows.map((r) => String(r.application_id));
    const merged = [...new Set([...beforeLinks, ...g.application_ids])].sort();
    const sameLinks =
      beforeLinks.length === merged.length &&
      beforeLinks.every((id, i) => id === merged[i]);

    if (
      !sameLinks ||
      (existing.status === "open" &&
        (existing.title !== g.title || existing.detail !== g.detail))
    ) {
      await setTaskApplications(db, existing.id, merged);
      if (existing.status === "open" || existing.status === "snoozed") {
        await updateTask(db, existing.id, {
          title: g.title,
          detail: g.detail,
          kind: g.kind,
          priority: merged.length,
        });
      }
      updated += 1;
    } else {
      unchanged += 1;
    }
    task_ids.push(existing.id);
  }

  return { created, updated, unchanged, groups: groups.length, task_ids };
}
