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

export function TokensAdmin() {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [name, setName] = useState("deisy-bot");
  const [scopes, setScopes] = useState("read,notes");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/tokens");
    if (!res.ok) {
      setError("Could not load tokens");
      return;
    }
    const data = await res.json();
    setTokens(data.tokens as TokenView[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
          <p className="user">API tokens · ryan only</p>
        </div>
        <div className="top-actions">
          <Link className="btn ghost" href="/">
            Dashboard
          </Link>
        </div>
      </header>

      <section className="section">
        <h1>Mint token</h1>
        <p className="muted">
          Plaintext is shown once. Scopes: <code>read</code>, <code>notes</code>{" "}
          (notes+done), <code>ingest</code>. Scoped bot tokens without{" "}
          <code>ingest</code> cannot upsert.
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
