"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const loadGen = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem("deisy-jobs-lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);

  function changeLang(l: Lang) {
    setLang(l);
    localStorage.setItem("deisy-jobs-lang", l);
  }

  const filtersActive = Boolean(
    filters.status || filters.company || filters.from || filters.to || filters.cv
  );

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
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
      if (gen !== loadGen.current) return;
      const list = data.applications as ApplicationRow[];
      setApps(list);
      setLoading(false);

      // Prefetch notes for open Needs-Deisy cards (non-blocking)
      const needs = list.filter((a) => a.status === "Needs-Deisy" && !a.done_at);
      const map: Record<string, NoteRow[]> = {};
      await Promise.all(
        needs.slice(0, 20).map(async (a) => {
          const r = await fetch(`/api/applications/${a.id}`);
          if (r.ok) {
            const d = await r.json();
            map[a.id] = d.notes as NoteRow[];
          }
        })
      );
      if (gen !== loadGen.current) return;
      setNotesById(map);
    } catch {
      if (gen !== loadGen.current) return;
      setError("error");
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const tmr = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(tmr);
  }, [load]);

  const { pinned, rest } = useMemo(() => {
    if (filtersActive) {
      return { pinned: [] as ApplicationRow[], rest: apps };
    }
    const pinnedList = apps.filter(
      (a) => a.status === "Needs-Deisy" && !a.done_at
    );
    const restList = apps.filter(
      (a) => !(a.status === "Needs-Deisy" && !a.done_at)
    );
    return { pinned: pinnedList, rest: restList };
  }, [apps, filtersActive]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">{t(lang, "appName")}</p>
          <p className="user">
            {userName} · {lang.toUpperCase()}
          </p>
        </div>
        <div className="top-actions">
          <Link className="btn ghost" href="/todos">
            {t(lang, "todos")}
          </Link>
          {userName === "ryan" ? (
            <a className="btn ghost" href="/admin/tokens">
              Tokens
            </a>
          ) : null}
          <LangToggle lang={lang} onChange={changeLang} />
          <button type="button" className="btn ghost" onClick={logout}>
            {t(lang, "logout")}
          </button>
        </div>
      </header>

      <Filters lang={lang} value={filters} onChange={setFilters} />

      {loading ? <p className="muted">{t(lang, "loading")}</p> : null}
      {error ? <p className="error">{t(lang, "error")}</p> : null}

      {!filtersActive && pinned.length > 0 && (
        <section className="section">
          <h1>
            {t(lang, "needsDeisy")}{" "}
            <span className="count">({pinned.length})</span>
          </h1>
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
          {filtersActive ? t(lang, "filters") : t(lang, "all")}{" "}
          <span className="count">({filtersActive ? apps.length : rest.length})</span>
        </h1>
        {(filtersActive ? apps : rest).length === 0 && !loading ? (
          <p className="muted">{t(lang, "empty")}</p>
        ) : (
          <div className="card-list">
            {(filtersActive ? apps : rest).map((app) => (
              <ApplicationCard
                key={app.id}
                lang={lang}
                app={app}
                notes={notesById[app.id] ?? []}
                pinned={app.status === "Needs-Deisy" && !app.done_at}
                onUpdated={load}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
