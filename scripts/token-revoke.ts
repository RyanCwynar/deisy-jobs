#!/usr/bin/env tsx
import { ensureSchema, getDb, resetDb } from "../src/lib/db";
import { revokeToken, revokeTokenByName } from "../src/lib/tokens";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const id = arg("--id");
  const name = arg("--name");
  if (!id && !name) {
    console.error(
      "Usage: npm run token:revoke -- --id <uuid>  OR  --name deisy-bot"
    );
    process.exit(1);
  }

  resetDb();
  const db = await ensureSchema(getDb());

  if (id) {
    const token = await revokeToken(db, id);
    if (!token) {
      console.error("Token not found");
      process.exit(1);
    }
    console.log(`Revoked id=${token.id} name=${token.name} at ${token.revoked_at}`);
    return;
  }

  const revoked = await revokeTokenByName(db, name!);
  if (revoked.length === 0) {
    console.error("No active tokens with that name");
    process.exit(1);
  }
  for (const t of revoked) {
    console.log(`Revoked id=${t.id} name=${t.name} at ${t.revoked_at}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
