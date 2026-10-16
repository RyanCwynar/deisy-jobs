"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type TokenView = {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

type ResumeView = {
  id: string;
  lang: string;
  filename: string;
  size: number;
  sha256: string;
  created_at: string;
};

function currentByLang(resumes: ResumeView[]): ResumeView[] {
  const seen = new Set<string>();
  const out: ResumeView[] = [];
  for (const r of resumes) {
    if (seen.has(r.lang)) continue;
    seen.add(r.lang);
    out.push(r);
  }
  return out.sort((a, b) => a.lang.localeCompare(b.lang));
}

export function TokensAdmin() {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [resumes, setResumes] = useState<ResumeView[]>([]);
  const [name, setName] = useState("deisy-bot");
  const [scopes, setScopes] = useState("read,notes");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tokRes, resumeRes] = await Promise.all([
      fetch("/api/admin/tokens"),
      fetch("/api/resumes"),
    ]);
    if (!tokRes.ok) {
      setError("Could not load tokens");
      return;
    }
    const data = await tokRes.json();
    setTokens(data.tokens as TokenView[]);
    if (resumeRes.ok) {
      const rd = await resumeRes.json();
      setResumes(rd.resumes as ResumeView[]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentResumes = currentByLang(resumes);

  async function onMint(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPlaintext(null);
    try {
      const res = await fetch("/api/admin/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Mint failed");
        return;
      }
      setPlaintext(data.plaintext as string);
      await load();
    } catch {
      setError("Mint failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this token? It cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tokens/${id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Revoke failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">deisy-jobs</p>
          <p className="user">Admin · ryan only</p>
        </div>
        <div className="top-actions">
          <Link className="btn ghost" href="/">
            Dashboard
          </Link>
        </div>
      </header>

      <section className="section">
        <h1>Current resumes</h1>
        <p className="muted">
          Latest PDF per language. Upload via{" "}
          <code>POST /api/resumes</code> with ingest Bearer.
        </p>
        {currentResumes.length === 0 ? (
          <p className="muted">No resumes uploaded yet.</p>
        ) : (
          <ul className="token-list">
            {currentResumes.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.lang.toUpperCase()}</strong>{" "}
                  <span className="muted">{r.filename}</span>
                  <div className="muted small">
                    {(r.size / 1024).toFixed(1)} KB · sha256{" "}
                    {r.sha256.slice(0, 12)}… · {r.created_at}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h1>Mint token</h1>
        <p className="muted">
          Plaintext is shown once. Scopes: <code>read</code>, <code>notes</code>{" "}
          (notes+done), <code>write</code> (MCP upsert/status/resume),{" "}
          <code>ingest</code>. Scoped bot tokens without <code>ingest</code>{" "}
          cannot REST-upsert.
        </p>
        <form className="token-form" onSubmit={onMint}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={64}
            />
          </label>
          <label>
            Scopes
            <input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              required
              placeholder="read,notes"
            />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            Mint
          </button>
        </form>
        {plaintext ? (
          <div className="token-once">
            <p>
              <strong>Copy now</strong> — this plaintext will not be shown again:
            </p>
            <code className="token-plain">{plaintext}</code>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="section">
        <h1>Tokens</h1>
        {tokens.length === 0 ? (
          <p className="muted">No tokens yet.</p>
        ) : (
          <ul className="token-list">
            {tokens.map((t) => (
              <li key={t.id} className={t.revoked_at ? "revoked" : ""}>
                <div>
                  <strong>{t.name}</strong>{" "}
                  <span className="muted">{t.scopes.join(", ")}</span>
                  <div className="muted small">
                    id {t.id.slice(0, 8)}… · created {t.created_at}
                    {t.last_used_at ? ` · last used ${t.last_used_at}` : ""}
                    {t.revoked_at ? ` · revoked ${t.revoked_at}` : ""}
                  </div>
                </div>
                {!t.revoked_at ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void onRevoke(t.id)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
