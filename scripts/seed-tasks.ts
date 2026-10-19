#!/usr/bin/env tsx
import { ensureSchema, getDb, resetDb } from "../src/lib/db";
import { seedTasksFromNeedsDeisy } from "../src/lib/task-seed";

async function main() {
  resetDb();
  const db = await ensureSchema(getDb());
  const result = await seedTasksFromNeedsDeisy(db, { created_by: "seed" });
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
