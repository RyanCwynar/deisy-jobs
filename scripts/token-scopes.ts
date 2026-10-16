#!/usr/bin/env tsx
import { ensureSchema, getDb, resetDb } from "../src/lib/db";
import { parseScopes } from "../src/lib/scopes";
import { getTokenById, setTokenScopes } from "../src/lib/tokens";

async function main() {
  // npm run token:scopes -- <id> read,notes,write
  const positional = process.argv.slice(2).filter((a) => a !== "--");
  const id = positional[0];
  const scopesRaw = positional[1];
  if (!id || !scopesRaw) {
    console.error(
      "Usage: npm run token:scopes -- <id> read,notes,write"
    );
    process.exit(1);
  }
  const scopes = parseScopes(scopesRaw);
  if (scopes.length === 0) {
    console.error("No valid scopes. Use: read, notes, ingest, write");
    process.exit(1);
  }

  resetDb();
  const db = await ensureSchema(getDb());
  const existing = await getTokenById(db, id);
  if (!existing) {
    console.error(`Token not found: ${id}`);
    process.exit(1);
  }
  const token = await setTokenScopes(db, id, scopes);
  console.log(`id=${token!.id}`);
  console.log(`name=${token!.name}`);
  console.log(`scopes=${token!.scopes.join(",")}`);
  console.log(`previous=${existing.scopes.join(",")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
