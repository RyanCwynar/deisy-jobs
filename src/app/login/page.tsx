"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "invalid"
      ? "Link expired or invalid"
      : params.get("error") === "config"
        ? "Server missing SESSION_SECRET"
        : null
  );
  const [magicMsg, setMagicMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        return;
      }
      const next = params.get("next") || "/";
      window.location.href = next;
    } finally {
      setBusy(false);
    }
  }

  async function sendMagic() {
    setBusy(true);
    setError(null);
    setMagicMsg(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 503) {
        setError("Magic link not configured");
        return;
      }
      if (!res.ok) {
        setError("Could not send link");
        return;
      }
      setMagicMsg("Check your email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>deisy-jobs</h1>
        <p className="lede">Private tracker for Deisy & Ryan</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          {magicMsg ? <p className="muted">{magicMsg}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>
            Log in
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy || !email}
            onClick={sendMagic}
          >
            Send magic link
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-page">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
