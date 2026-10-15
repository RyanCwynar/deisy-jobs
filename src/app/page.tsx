import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { listApplications } from "@/lib/applications";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = await ensureSchema(getDb());
  // SSR only open Needs-Deisy pins; full filtered list loads client-side
  const apps = await listApplications(db, { status: "Needs-Deisy" });
  const pinned = apps.filter((a) => !a.done_at);

  return <Dashboard initial={pinned} userName={session.name} />;
}
