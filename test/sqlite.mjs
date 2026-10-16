// The app's `{ query }` database interface on Node's built-in SQLite, with the real schema.
// Same SQL dialect as Cloudflare D1, so the end-to-end tests exercise the production queries.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { toParam } from "../lib/server/db.mjs";

const RETURNS_ROWS = /^\s*(select|with)\b|\breturning\b/i;

export function sqliteDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      const args = params.map(toParam);
      if (RETURNS_ROWS.test(sql)) {
        const rows = stmt.all(...args).map((r) => ({ ...r }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: Number(stmt.run(...args).changes) };
    },
  };
}
