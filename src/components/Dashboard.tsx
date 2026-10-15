"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApplicationRow, NoteRow } from "@/lib/db";
import { t, type Lang } from "@/lib/i18n";
import { ApplicationCard } from "./ApplicationCard";
import { Filters, type FilterState } from "./Filters";
import { LangToggle } from "./LangToggle";

type Props = {
  initial: ApplicationRow[];
  userName: string;
};

export function Dashboard({ initial, userName }: Props) {
  const [lang, setLang] = useState<Lang>("en");
  const [apps, setApps] = useState(initial);
  const [notesById, setNotesById] = useState<Record<string, NoteRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    status: "",
    company: "",
    from: "",
    to: "",
    cv: "",
  });

  useEffect(() => {
    const saved = localStorage.getItem("deisy-jobs-lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);

  function changeLang(l: Lang) {
    setLang(l);
    localStorage.setItem("deisy-jobs-lang", l);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (filters.status) q.set("status", filters.status);
      if (filters.company) q.set("company", filters.company);
      if (filters.from) q.set("from", filters.from);
      if (filters.to) q.set("to", filters.to);
      if (filters.cv) q.set("cv", filters.cv);
      const res = await fetch(`/api/applications?${q.toString()}`);
      if (!res.ok) throw new Error("fail");
      const data = await res.json();
      setApps(data.applications as ApplicationRow[]);

      // Prefetch notes for Needs-Deisy cards
      const needs = (data.applications as ApplicationRow[]).filter(
        (a) => a.status === "Needs-Deisy" && !a.done_at
      );
      const map: Record<string, NoteRow[]> = {};
      await Promise.all(
        needs.slice(0, 30).map(async (a) => {
          const r = await fetch(`/api/applications/${a.id}`);
          if (r.ok) {
            const d = await r.json();
            map[a.id] = d.notes as NoteRow[];
          }
        })
      );
      setNotesById(map);
    } catch {
      setError(t(lang, "error"));
    } finally {
      setLoading(false);
    }
  }, [filters, lang]);

  useEffect(() => {
    const tmr = setTimeout(() => {
      void load();
    }, 200);
    return () => clearTimeout(tmr);
  }, [load]);

  const { pinned, rest } = useMemo(() => {
    const pinnedList = apps.filter(
      (a) => a.status === "Needs-Deisy" && !a.done_at
    );
    const restList = apps.filter(
      (a) => !(a.status === "Needs-Deisy" && !a.done_at)
    );
    return { pinned: pinnedList, rest: restList };
  }, [apps]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">{t(lang, "appName")}</p>
          <p className="user">{userName}</p>
        </div>
        <div className="top-actions">
          <LangToggle lang={lang} onChange={changeLang} />
          <button type="button" className="btn ghost" onClick={logout}>
            {t(lang, "logout")}
          </button>
        </div>
      </header>

      <Filters lang={lang} value={filters} onChange={setFilters} />

      {loading ? <p className="muted">{t(lang, "loading")}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {pinned.length > 0 && (
        <section className="section">
          <h1>{t(lang, "needsDeisy")}</h1>
          <div className="card-list">
            {pinned.map((app) => (
              <ApplicationCard
                key={app.id}
                lang={lang}
                app={app}
                notes={notesById[app.id] ?? []}
                pinned
                onUpdated={load}
              />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h1>
          {filters.status || filters.company
            ? t(lang, "filters")
            : t(lang, "all")}{" "}
          <span className="count">({rest.length})</span>
        </h1>
        {rest.length === 0 && !loading ? (
          <p className="muted">{t(lang, "empty")}</p>
        ) : (
          <div className="card-list">
            {rest.map((app) => (
              <ApplicationCard
                key={app.id}
                lang={lang}
                app={app}
                notes={notesById[app.id] ?? []}
                onUpdated={load}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
