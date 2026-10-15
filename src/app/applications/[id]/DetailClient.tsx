"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApplicationRow, NoteRow } from "@/lib/db";
import type { Lang } from "@/lib/i18n";
import { ApplicationCard } from "@/components/ApplicationCard";
import { LangToggle } from "@/components/LangToggle";

export function DetailClient({
  app,
  notes,
  userName,
}: {
  app: ApplicationRow;
  notes: NoteRow[];
  userName: string;
}) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");

  return (
    <>
      <div className="topbar">
        <div>
          <p className="brand">#{app.id}</p>
          <p className="user">{userName}</p>
        </div>
        <LangToggle lang={lang} onChange={setLang} />
      </div>
      <ApplicationCard
        lang={lang}
        app={app}
        notes={notes}
        pinned={app.status === "Needs-Deisy"}
        onUpdated={() => router.refresh()}
      />
    </>
  );
}
