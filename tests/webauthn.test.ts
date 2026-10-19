import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { ensureSchema, resetDb } from "../src/lib/db";
import {
  beginAuthentication,
  beginRegistration,
  consumeChallenge,
  createChallenge,
  finishAuthentication,
  finishRegistration,
  getWebAuthnConfig,
  listCredentialsForEmail,
} from "../src/lib/webauthn";

const tmpFiles: string[] = [];

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-32chars!!";
  process.env.DEISY_EMAIL = "deisy@example.com";
  process.env.DEISY_PASSWORD_HASH = bcrypt.hashSync("deisy-pass", 4);
  process.env.RYAN_EMAIL = "ryan@example.com";
  process.env.RYAN_PASSWORD_HASH = bcrypt.hashSync("ryan-pass", 4);
  process.env.APP_URL = "https://deisy.byldr.co";
  delete process.env.RP_ID;
});

afterEach(() => {
  resetDb();
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  delete process.env.SESSION_SECRET;
  delete process.env.DEISY_EMAIL;
  delete process.env.DEISY_PASSWORD_HASH;
  delete process.env.RYAN_EMAIL;
  delete process.env.RYAN_PASSWORD_HASH;
  delete process.env.APP_URL;
  delete process.env.RP_ID;
  delete process.env.DATABASE_URL;
  delete process.env.WEBAUTHN_RP_NAME;
});

function tmpDbUrl() {
  const file = path.join(
    os.tmpdir(),
    `deisy-webauthn-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  tmpFiles.push(file);
  process.env.DATABASE_URL = `file:${file}`;
  resetDb();
  return file;
}

function fakeClientData(challenge: string) {
  return isoBase64URL.fromUTF8String(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin: "https://deisy.byldr.co",
    })
  );
}

describe("getWebAuthnConfig", () => {
  it("derives RP ID from public origin host", () => {
    const cfg = getWebAuthnConfig(null);
    expect(cfg.origin).toBe("https://deisy.byldr.co");
    expect(cfg.rpID).toBe("deisy.byldr.co");
  });

  it("allows RP_ID override", () => {
    process.env.RP_ID = "byldr.co";
    expect(getWebAuthnConfig(null).rpID).toBe("byldr.co");
  });

  it("maps loopback host to localhost", () => {
    delete process.env.APP_URL;
    process.env.APP_URL = "http://127.0.0.1:3010";
    expect(getWebAuthnConfig(null).rpID).toBe("localhost");
  });
});

describe("webauthn challenges", () => {
  it("rejects expired and reused challenges", async () => {
    tmpDbUrl();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());

    const { id } = await createChallenge(db, {
      purpose: "auth",
      challenge: "chal-live",
      userEmail: "deisy@example.com",
    });
    expect(id).toBeTruthy();

    const ok = await consumeChallenge(db, {
      challenge: "chal-live",
      purpose: "auth",
    });
    expect(ok.ok).toBe(true);

    const reused = await consumeChallenge(db, {
      challenge: "chal-live",
      purpose: "auth",
    });
    expect(reused.ok).toBe(false);

    await db.execute({
      sql: `
        INSERT INTO webauthn_challenges (id, user_email, challenge, purpose, expires_at, used)
        VALUES (?, ?, ?, ?, ?, 0)
      `,
      args: [
        "expired-1",
        "deisy@example.com",
        "chal-old",
        "auth",
        new Date(Date.now() - 60_000).toISOString(),
      ],
    });
    const expired = await consumeChallenge(db, {
      challenge: "chal-old",
      purpose: "auth",
    });
    expect(expired).toEqual({ ok: false, error: "Challenge expired" });
  });
});

describe("webauthn registration + auth with mocked verifier", () => {
  it("stores credential and authenticates with counter advance", async () => {
    tmpDbUrl();
    const { getDb } = await import("../src/lib/db");
    const db = await ensureSchema(getDb());
    const user = { email: "deisy@example.com", name: "deisy" as const };

    const options = await beginRegistration(db, user, null);
    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe("deisy.byldr.co");

    const credId = "cred-abc123";
    const publicKey = new Uint8Array([1, 2, 3, 4]);
    const response = {
      id: credId,
      rawId: credId,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: fakeClientData(options.challenge),
        attestationObject: "attestation",
        transports: ["internal"] as const,
      },
    };

    const verifyRegistration = vi.fn(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: credId,
          publicKey,
          counter: 0,
        },
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
        aaguid: "00000000-0000-0000-0000-000000000000",
      },
    }));

    const { credential } = await finishRegistration(
      db,
      user,
      response,
      null,
      { verifyRegistration: verifyRegistration as never }
    );
    expect(credential.credential_id).toBe(credId);
    expect(credential.counter).toBe(0);
    expect(verifyRegistration).toHaveBeenCalledOnce();

    const listed = await listCredentialsForEmail(db, user.email);
    expect(listed).toHaveLength(1);

    const authOpts = await beginAuthentication(
      db,
      { email: user.email },
      null
    );
    expect(authOpts.allowCredentials?.[0]?.id).toBe(credId);

    const authResponse = {
      id: credId,
      rawId: credId,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromUTF8String(
          JSON.stringify({
            type: "webauthn.get",
            challenge: authOpts.challenge,
            origin: "https://deisy.byldr.co",
          })
        ),
        authenticatorData: "authdata",
        signature: "sig",
        userHandle: null,
      },
    };

    const verifyAuthentication = vi.fn(async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialID: credId,
        userVerified: true,
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
        origin: "https://deisy.byldr.co",
        rpID: "deisy.byldr.co",
      },
    }));

    const authed = await finishAuthentication(db, authResponse, null, {
      verifyAuthentication: verifyAuthentication as never,
    });
    expect(authed.user).toEqual(user);
    expect(authed.credential.counter).toBe(1);
    expect(authed.credential.last_used_at).toBeTruthy();

    // Replay: same counter must fail
    await createChallenge(db, {
      purpose: "auth",
      challenge: "chal-replay",
      userEmail: user.email,
    });
    const replayResponse = {
      ...authResponse,
      response: {
        ...authResponse.response,
        clientDataJSON: isoBase64URL.fromUTF8String(
          JSON.stringify({
            type: "webauthn.get",
            challenge: "chal-replay",
            origin: "https://deisy.byldr.co",
          })
        ),
      },
    };
    const verifyReplay = vi.fn(async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialID: credId,
        userVerified: true,
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
        origin: "https://deisy.byldr.co",
        rpID: "deisy.byldr.co",
      },
    }));
    await expect(
      finishAuthentication(db, replayResponse, null, {
        verifyAuthentication: verifyReplay as never,
      })
    ).rejects.toThrow(/Replay detected/);
  });
});
