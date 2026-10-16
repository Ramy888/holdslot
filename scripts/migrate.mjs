// Applies db/schema.sql, then seeds the demo business if the database is empty.
import { readFile } from "node:fs/promises";
import { pool } from "../lib/server/db.mjs";
import { seedIfEmpty } from "../lib/server/seed.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; skipping migrations.");
  process.exit(0);
}
const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = pool();
try {
  await db.query(sql);
  const seeded = await seedIfEmpty(db);
  console.log(JSON.stringify({ msg: "migrations applied", seeded }));
} finally {
  await db.end();
}
