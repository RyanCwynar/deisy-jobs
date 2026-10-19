"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("error") === "invalid"
      ? "Link expired or invalid"
      : params.get("error") === "config"
        ? "Server missing SESSION_SECRET"
        : null
  );
  const [magicMsg, setMagicMsg] = useState<string | null>(null);
  const [magicEnabled, setMagicEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passkeyOk, setPasskeyOk] = useState(false);

  useEffect(() => {
    setPasskeyOk(browserSupportsWebAuthn());
    void fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d?.magic_link) setMagicEnabled(true);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (!email || !password) {
      setError("Email and password required");
      setBusy(false);
      return;
    }
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
      window.location.href = params.get("next") || "/";
    } finally {
      setBusy(false);
    }
  }

  async function sendMagic(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    setMagicMsg(null);
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 503) {
        setMagicMsg("Magic link unavailable");
        return;
      }
      if (!res.ok) {
        setMagicMsg("Could not send link");
        return;
      }
      setMagicMsg("Check your email");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    setMagicMsg(null);
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    try {
      const optRes = await fetch("/api/auth/webauthn/auth/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email ? { email } : {}),
      });
      const options = await optRes.json();
      if (!optRes.ok) {
        setError(options.error ?? "Passkey sign-in unavailable");
        return;
      }

      const authResp = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch("/api/auth/webauthn/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResp),
      });
      const ver = await verRes.json().catch(() => ({}));
      if (!verRes.ok) {
        setError(ver.error ?? "Passkey sign-in failed");
        return;
      }
      window.location.href = params.get("next") || "/";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Passkey sign-in cancelled"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>deisy-jobs</h1>
        <p className="lede">Private tracker for Deisy & Ryan</p>
        <form
          className="login-form"
          onSubmit={onSubmit}
          id="login-form"
        >
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username webauthn"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          {magicMsg ? <p className="muted">{magicMsg}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>
            Log in
          </button>
          {passkeyOk ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                const form = document.getElementById(
                  "login-form"
                ) as HTMLFormElement | null;
                if (form) void signInWithPasskey(form);
              }}
            >
              Sign in with a passkey
            </button>
          ) : null}
          {magicEnabled ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                const form = document.getElementById(
                  "login-form"
                ) as HTMLFormElement | null;
                if (form) void sendMagic(form);
              }}
            >
              Send magic link
            </button>
          ) : null}
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
