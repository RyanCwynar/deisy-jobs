"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";

type CredView = {
  id: string;
  credential_id: string;
  transports: string[];
  created_at: string;
  last_used_at: string | null;
};

export function PasskeySettings({ userName }: { userName: string }) {
  const [credentials, setCredentials] = useState<CredView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/webauthn/credentials");
    if (!res.ok) {
      setError("Could not load passkeys");
      return;
    }
    const data = await res.json();
    setCredentials(data.credentials as CredView[]);
  }, []);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const optRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
      });
      const options = await optRes.json();
      if (!optRes.ok) {
        setError(options.error ?? "Could not start registration");
        return;
      }

      const attResp = await startRegistration({ optionsJSON: options });
      const verRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      });
      const ver = await verRes.json();
      if (!verRes.ok) {
        setError(ver.error ?? "Could not save passkey");
        return;
      }
      setMsg("Passkey added");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Passkey registration cancelled"
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    if (!confirm("Remove this passkey?")) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/auth/webauthn/credentials/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Delete failed");
        return;
      }
      setMsg("Passkey removed");
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
          <p className="user">{userName} · Account</p>
        </div>
        <div className="top-actions">
          <Link className="btn ghost" href="/">
            Dashboard
          </Link>
        </div>
      </header>

      <section className="section">
        <h1>Passkeys</h1>
        <p className="muted">
          Sign in with Face ID, Touch ID, or a device passkey after you enroll
          one here (password login required first).
        </p>

        {!supported ? (
          <p className="error">This browser does not support passkeys.</p>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void addPasskey()}
          >
            Add a passkey
          </button>
        )}

        {error ? <p className="error">{error}</p> : null}
        {msg ? <p className="muted">{msg}</p> : null}

        <ul className="token-list">
          {credentials.length === 0 ? (
            <li className="muted">No passkeys enrolled yet.</li>
          ) : (
            credentials.map((c) => (
              <li key={c.id}>
                <div>
                  <code>{c.credential_id.slice(0, 16)}…</code>
                  <div className="muted small">
                    Added {new Date(c.created_at).toLocaleString()}
                    {c.last_used_at
                      ? ` · Last used ${new Date(c.last_used_at).toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void removePasskey(c.id)}
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
