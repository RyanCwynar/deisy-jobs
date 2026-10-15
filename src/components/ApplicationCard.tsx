"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ApplicationRow, NoteRow } from "@/lib/db";
import { statusLabel, t, type Lang } from "@/lib/i18n";

export function ApplicationCard({
  lang,
  app,
  notes = [],
  pinned = false,
  onUpdated,
}: {
  lang: Lang;
  app: ApplicationRow;
  notes?: NoteRow[];
  pinned?: boolean;
  onUpdated?: () => void;
}) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function markDone(done: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/applications/${app.id}/done`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      if (!res.ok) {
        setError(t(lang, "error"));
        return;
      }
      onUpdated?.();
    });
  }

  function sendReply() {
    if (!reply.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/applications/${app.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) {
        setError(t(lang, "error"));
        return;
      }
      setReply("");
      onUpdated?.();
    });
  }

  const isDone = Boolean(app.done_at);

  return (
    <article
      className={`app-card ${pinned ? "pinned" : ""} ${isDone ? "done" : ""}`}
    >
      <header>
        <div className="app-id">#{app.id}</div>
        <span className={`badge status-${app.status}`}>
          {statusLabel(lang, app.status)}
        </span>
        {app.cv ? <span className="badge cv">{app.cv}</span> : null}
      </header>
      <h2>{app.company}</h2>
      <p className="role">{app.role}</p>
      {app.location ? <p className="meta">{app.location}</p> : null}
      {app.listed_pay ? (
        <p className="meta">
          {t(lang, "pay")}: {app.listed_pay}
        </p>
      ) : null}
      {app.status_reason ? (
        <p className="reason">
          <strong>{t(lang, "reason")}:</strong> {app.status_reason}
        </p>
      ) : null}
      {app.notes ? <p className="notes-text">{app.notes}</p> : null}

      <div className="actions">
        {app.apply_link ? (
          <a
            href={app.apply_link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn secondary"
          >
            {t(lang, "openLink")}
          </a>
        ) : null}
        {pinned || app.status === "Needs-Deisy" ? (
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => markDone(!isDone)}
          >
            {isDone ? t(lang, "undoDone") : t(lang, "markDone")}
          </button>
        ) : null}
        <Link href={`/applications/${app.id}`} className="btn ghost">
          {t(lang, "detail")}
        </Link>
      </div>

      {(pinned || app.status === "Needs-Deisy") && (
        <div className="reply-box">
          {notes.length > 0 && (
            <ul className="note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="author">{n.author}</span> {n.body}
                </li>
              ))}
            </ul>
          )}
          <label className="sr-only" htmlFor={`reply-${app.id}`}>
            {t(lang, "reply")}
          </label>
          <textarea
            id={`reply-${app.id}`}
            rows={2}
            placeholder={t(lang, "reply")}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button
            type="button"
            className="btn primary"
            disabled={pending || !reply.trim()}
            onClick={sendReply}
          >
            {t(lang, "send")}
          </button>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
      <footer className="meta">
        {app.date_found ? (
          <span>
            {t(lang, "found")}: {app.date_found}
          </span>
        ) : null}
        {app.date_applied ? (
          <span>
            {t(lang, "applied")}: {app.date_applied}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
