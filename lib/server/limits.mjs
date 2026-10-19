// Fixed-window counters kept in the database, so a cap holds across every Cloudflare Worker
// copy (a counter in memory only counted per copy). They protect the paid AI calls and the
// front-desk login.
import { database } from "./db.mjs";

/** True while `key` has made at most `limit` calls in the current window of `windowMs`. */
export async function allow(key, limit, windowMs, { db = database(), now = Date.now() } = {}) {
  const { rows } = await db.query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limits.window_start END
     RETURNING count`,
    [key, now, windowMs],
  );
  return Number(rows[0].count) <= limit;
}

/**
 * The visitor a limit is counted against. Cloudflare sets CF-Connecting-IP itself; the first
 * X-Forwarded-For entry is whatever the client sent, so it is never used.
 * @param {Headers} headers
 */
export const clientKey = (headers) => headers.get("cf-connecting-ip")?.trim() || "local";
