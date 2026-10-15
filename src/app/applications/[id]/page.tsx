import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { ensureSchema, getDb } from "@/lib/db";
import { getApplication, getNotes } from "@/lib/applications";
import { DetailClient } from "./DetailClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ApplicationDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const db = await ensureSchema(getDb());
  const app = await getApplication(db, id);
  if (!app) notFound();
  const notes = await getNotes(db, id);

  return (
    <div className="shell detail-page">
      <p>
        <Link href="/">← deisy-jobs</Link>
      </p>
      <DetailClient app={app} notes={notes} userName={session.name} />
    </div>
  );
}
