import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { SessionUser } from "./auth";
import { findUserByEmail } from "./auth";
import { ensureSchema } from "./db";
import {
  resolvePublicOrigin,
  type OriginRequestLike,
} from "./public-origin";

export type WebAuthnCredentialRow = {
  id: string;
  user_email: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type ChallengePurpose = "register" | "auth";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export function getWebAuthnConfig(req?: OriginRequestLike | null): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const origin = resolvePublicOrigin(req);
  const host = new URL(origin).hostname;
  const rpID =
    process.env.RP_ID?.trim() ||
    (host === "127.0.0.1" || host === "[::1]" ? "localhost" : host);
  return {
    rpID,
    rpName: process.env.WEBAUTHN_RP_NAME?.trim() || "deisy-jobs",
    origin,
  };
}

export async function createChallenge(
  db: Client,
  opts: {
    purpose: ChallengePurpose;
    challenge: string;
    userEmail?: string | null;
  }
): Promise<{ id: string; expires_at: string }> {
  await ensureSchema(db);
  const id = randomUUID();
  const expires_at = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await db.execute({
    sql: `
      INSERT INTO webauthn_challenges (id, user_email, challenge, purpose, expires_at, used)
      VALUES (?, ?, ?, ?, ?, 0)
    `,
    args: [
      id,
      opts.userEmail?.toLowerCase() ?? null,
      opts.challenge,
      opts.purpose,
      expires_at,
    ],
  });
  return { id, expires_at };
}

export async function consumeChallenge(
  db: Client,
  opts: {
    challenge: string;
    purpose: ChallengePurpose;
    userEmail?: string | null;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `
      SELECT * FROM webauthn_challenges
      WHERE challenge = ? AND purpose = ? AND used = 0
      ORDER BY expires_at DESC
      LIMIT 1
    `,
    args: [opts.challenge, opts.purpose],
  });
  const row = result.rows[0];
  if (!row) return { ok: false, error: "Unknown or already used challenge" };
  const expires_at = String(row.expires_at);
  if (new Date(expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Challenge expired" };
  }
  if (opts.userEmail) {
    const stored = row.user_email == null ? null : String(row.user_email);
    if (stored && stored !== opts.userEmail.toLowerCase()) {
      return { ok: false, error: "Challenge user mismatch" };
    }
  }
  await db.execute({
    sql: `UPDATE webauthn_challenges SET used = 1 WHERE id = ?`,
    args: [String(row.id)],
  });
  return { ok: true, id: String(row.id) };
}

export async function listCredentialsForEmail(
  db: Client,
  email: string
): Promise<WebAuthnCredentialRow[]> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM webauthn_credentials WHERE user_email = ? ORDER BY created_at DESC`,
    args: [email.toLowerCase()],
  });
  return result.rows.map((r) => ({
    id: String(r.id),
    user_email: String(r.user_email),
    credential_id: String(r.credential_id),
    public_key: String(r.public_key),
    counter: Number(r.counter ?? 0),
    transports: (r.transports as string) ?? null,
    created_at: String(r.created_at),
    last_used_at: (r.last_used_at as string) ?? null,
  }));
}

export async function getCredentialByCredentialId(
  db: Client,
  credentialId: string
): Promise<WebAuthnCredentialRow | null> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT * FROM webauthn_credentials WHERE credential_id = ?`,
    args: [credentialId],
  });
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    user_email: String(r.user_email),
    credential_id: String(r.credential_id),
    public_key: String(r.public_key),
    counter: Number(r.counter ?? 0),
    transports: (r.transports as string) ?? null,
    created_at: String(r.created_at),
    last_used_at: (r.last_used_at as string) ?? null,
  };
}

export async function deleteCredential(
  db: Client,
  opts: { id: string; userEmail: string }
): Promise<boolean> {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `DELETE FROM webauthn_credentials WHERE id = ? AND user_email = ?`,
    args: [opts.id, opts.userEmail.toLowerCase()],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

export async function beginRegistration(
  db: Client,
  user: SessionUser,
  req?: OriginRequestLike | null
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = getWebAuthnConfig(req);
  const existing = await listCredentialsForEmail(db, user.email);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.email),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransport[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });
  await createChallenge(db, {
    purpose: "register",
    challenge: options.challenge,
    userEmail: user.email,
  });
  return options;
}

export type VerifyDeps = {
  verifyRegistration?: typeof verifyRegistrationResponse;
  verifyAuthentication?: typeof verifyAuthenticationResponse;
};

export async function finishRegistration(
  db: Client,
  user: SessionUser,
  response: RegistrationResponseJSON,
  req?: OriginRequestLike | null,
  deps: VerifyDeps = {}
): Promise<{ credential: WebAuthnCredentialRow }> {
  const { rpID, origin } = getWebAuthnConfig(req);
  const verify = deps.verifyRegistration ?? verifyRegistrationResponse;

  // Challenge is inside clientDataJSON; SimpleWebAuthn checks expectedChallenge callback
  let expectedChallenge = "";
  try {
    const clientData = JSON.parse(
      isoBase64URL.toUTF8String(response.response.clientDataJSON)
    ) as { challenge?: string };
    expectedChallenge = String(clientData.challenge ?? "");
  } catch {
    throw new Error("Invalid clientDataJSON");
  }

  const consumed = await consumeChallenge(db, {
    challenge: expectedChallenge,
    purpose: "register",
    userEmail: user.email,
  });
  if (!consumed.ok) throw new Error(consumed.error);

  const verification: VerifiedRegistrationResponse = await verify({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  void credentialDeviceType;
  void credentialBackedUp;

  const id = randomUUID();
  const created_at = nowIso();
  const public_key = isoBase64URL.fromBuffer(credential.publicKey);
  const transports = response.response.transports
    ? JSON.stringify(response.response.transports)
    : null;

  await db.execute({
    sql: `
      INSERT INTO webauthn_credentials (
        id, user_email, credential_id, public_key, counter, transports, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    args: [
      id,
      user.email.toLowerCase(),
      credential.id,
      public_key,
      credential.counter,
      transports,
      created_at,
    ],
  });

  const row = await getCredentialByCredentialId(db, credential.id);
  if (!row) throw new Error("Failed to store credential");
  return { credential: row };
}

export async function beginAuthentication(
  db: Client,
  opts: { email?: string | null },
  req?: OriginRequestLike | null
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getWebAuthnConfig(req);
  let allowCredentials:
    | { id: string; transports?: AuthenticatorTransport[] }[]
    | undefined;

  let userEmail: string | null = null;
  if (opts.email) {
    const user = findUserByEmail(opts.email);
    if (!user) {
      // Avoid enumeration: still issue a challenge with empty allow list
      userEmail = opts.email.toLowerCase();
      allowCredentials = [];
    } else {
      userEmail = user.email;
      const creds = await listCredentialsForEmail(db, user.email);
      allowCredentials = creds.map((c) => ({
        id: c.credential_id,
        transports: c.transports
          ? (JSON.parse(c.transports) as AuthenticatorTransport[])
          : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials,
  });
  await createChallenge(db, {
    purpose: "auth",
    challenge: options.challenge,
    userEmail,
  });
  return options;
}

export async function finishAuthentication(
  db: Client,
  response: AuthenticationResponseJSON,
  req?: OriginRequestLike | null,
  deps: VerifyDeps = {}
): Promise<{ user: SessionUser; credential: WebAuthnCredentialRow }> {
  const { rpID, origin } = getWebAuthnConfig(req);
  const verify = deps.verifyAuthentication ?? verifyAuthenticationResponse;

  let expectedChallenge = "";
  try {
    const clientData = JSON.parse(
      isoBase64URL.toUTF8String(response.response.clientDataJSON)
    ) as { challenge?: string };
    expectedChallenge = String(clientData.challenge ?? "");
  } catch {
    throw new Error("Invalid clientDataJSON");
  }

  const consumed = await consumeChallenge(db, {
    challenge: expectedChallenge,
    purpose: "auth",
  });
  if (!consumed.ok) throw new Error(consumed.error);

  const stored = await getCredentialByCredentialId(db, response.id);
  if (!stored) throw new Error("Unknown credential");

  const user = findUserByEmail(stored.user_email);
  if (!user) throw new Error("Unknown user");

  const verification: VerifiedAuthenticationResponse = await verify({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credential_id,
      publicKey: isoBase64URL.toBuffer(stored.public_key),
      counter: stored.counter,
      transports: stored.transports
        ? (JSON.parse(stored.transports) as AuthenticatorTransport[])
        : undefined,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw new Error("Authentication verification failed");
  }

  const newCounter = verification.authenticationInfo.newCounter;
  // Replay safety: counter must advance (or stay 0 for some authenticators that don't increment)
  if (newCounter > 0 && newCounter <= stored.counter) {
    throw new Error("Replay detected: authenticator counter did not advance");
  }

  const last_used_at = nowIso();
  await db.execute({
    sql: `UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?`,
    args: [newCounter, last_used_at, stored.id],
  });

  const updated = await getCredentialByCredentialId(db, stored.credential_id);
  return {
    user: { email: user.email, name: user.name },
    credential: updated!,
  };
}

export function credentialPublicView(c: WebAuthnCredentialRow) {
  return {
    id: c.id,
    credential_id: c.credential_id,
    transports: c.transports ? JSON.parse(c.transports) : [],
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  };
}
