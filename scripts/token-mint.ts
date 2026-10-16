#!/usr/bin/env tsx
import { ensureSchema, getDb, resetDb } from "../src/lib/db";
import { mintToken } from "../src/lib/tokens";
import { parseScopes } from "../src/lib/scopes";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const name = arg("--name");
  const scopesRaw = arg("--scopes") ?? "read,notes";
  if (!name) {
    console.error(
      "Usage: npm run token:mint -- --name deisy-bot --scopes read,notes"
    );
    process.exit(1);
  }
  const scopes = parseScopes(scopesRaw);
  if (scopes.length === 0) {
    console.error("No valid scopes. Use: read, notes, ingest");
    process.exit(1);
  }

  resetDb();
  const db = await ensureSchema(getDb());
  const { token, plaintext } = await mintToken(db, { name, scopes });
  console.log(`id=${token.id}`);
  console.log(`name=${token.name}`);
  console.log(`scopes=${token.scopes.join(",")}`);
  console.log(`created_at=${token.created_at}`);
  console.log("");
  console.log("Plaintext token (shown once):");
  console.log(plaintext);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
