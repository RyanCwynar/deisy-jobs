"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { t, type Lang } from "@/lib/i18n";
import { LangToggle } from "./LangToggle";

type TaskApp = {
  id: string;
  company: string;
  role: string;
  listed_pay: string | null;
  apply_link: string | null;
  status: string;
};

type TaskView = {
  id: string;
  title: string;
  detail: string;
  kind: string;
  status: string;
  due_date: string | null;
  snoozed_until: string | null;
  instruction: string;
  linked_count: number;
  applications: TaskApp[];
};

export function TodosView({ userName }: { userName: string }) {
  const [lang, setLang] = useState<Lang>("en");
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

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
      const res = await fetch("/api/tasks/next?limit=50");
      if (!res.ok) throw new Error("fail");
      const data = await res.json();
      setTasks(data.tasks as TaskView[]);
    } catch {
      setError("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function complete(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("error");
        return;
      }
      await load();
    });
  }

  function snooze(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 3 }),
      });
      if (!res.ok) {
        setError("error");
        return;
      }
      await load();
    });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">{t(lang, "appName")}</p>
          <p className="user">
            {userName} · {t(lang, "todos")}
          </p>
        </div>
        <div className="top-actions">
          <Link className="btn ghost" href="/">
            {t(lang, "all")}
          </Link>
          <LangToggle lang={lang} onChange={changeLang} />
          <button type="button" className="btn ghost" onClick={logout}>
            {t(lang, "logout")}
          </button>
        </div>
      </header>

      <section className="section">
        <h1>
          {t(lang, "todos")}{" "}
          <span className="count">({tasks.length})</span>
        </h1>
        <p className="muted">{t(lang, "todosLede")}</p>
        {loading ? <p className="muted">{t(lang, "loading")}</p> : null}
        {error ? <p className="error">{t(lang, "error")}</p> : null}
        {!loading && tasks.length === 0 ? (
          <p className="muted">{t(lang, "todosEmpty")}</p>
        ) : null}
        <div className="card-list">
          {tasks.map((task) => (
            <article key={task.id} className="app-card todo-card">
              <header>
                <span className="badge">{task.kind}</span>
                {task.due_date ? (
                  <span className="badge cv">
                    {t(lang, "due")}: {task.due_date.slice(0, 10)}
                  </span>
                ) : null}
                <span className="muted small">
                  {task.linked_count}{" "}
                  {task.linked_count === 1
                    ? t(lang, "application")
                    : t(lang, "applications")}
                </span>
              </header>
              <h2>{task.title}</h2>
              <p className="role todo-instruction">{task.instruction}</p>
              <ul className="todo-apps">
                {task.applications.map((a) => (
                  <li key={a.id}>
                    <Link href={`/applications/${a.id}`}>
                      #{a.id} {a.company}
                    </Link>
                    <span className="muted"> — {a.role}</span>
                    {a.listed_pay ? (
                      <span className="muted"> · {a.listed_pay}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  disabled={pending}
                  onClick={() => complete(task.id)}
                >
                  {t(lang, "markDone")}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={pending}
                  onClick={() => snooze(task.id)}
                >
                  {t(lang, "snooze")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
