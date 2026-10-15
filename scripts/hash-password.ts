#!/usr/bin/env tsx
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npx tsx scripts/hash-password.ts '<password>'");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
// Next.js expands $VAR in .env — escape dollars when pasting into .env
console.log(hash);
console.log("");
console.log("For .env (escaped):");
console.log(hash.replace(/\$/g, "\\$"));
