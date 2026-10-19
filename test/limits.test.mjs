// The limits that protect paid AI calls and the front-desk login. They live in the database, so
// a cap holds across every Cloudflare Worker copy, and visitors are counted by the address
// Cloudflare sets (CF-Connecting-IP), never by the client-supplied X-Forwarded-For.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "./sqlite.mjs";
import { allow, clientKey } from "../lib/server/limits.mjs";

test("a cap is shared by every app copy, because the counter lives in the database", async () => {
  const db = sqliteDatabase();
  const now = 1_000_000;
  // Two Worker copies are just two callers of the same database.
  assert.equal(await allow("chat:all", 2, 60_000, { db, now }), true);
  assert.equal(await allow("chat:all", 2, 60_000, { db, now: now + 1 }), true);
  assert.equal(await allow("chat:all", 2, 60_000, { db, now: now + 2 }), false, "the third call is refused, whichever copy makes it");
});

test("the window resets once it has passed, and keys are counted separately", async () => {
  const db = sqliteDatabase();
  assert.equal(await allow("login:a", 1, 60_000, { db, now: 0 }), true);
  assert.equal(await allow("login:a", 1, 60_000, { db, now: 30_000 }), false);
  assert.equal(await allow("login:b", 1, 60_000, { db, now: 30_000 }), true, "another visitor has their own budget");
  assert.equal(await allow("login:a", 1, 60_000, { db, now: 60_000 }), true, "a new window starts");
});

test("visitors are counted by CF-Connecting-IP; a made-up X-Forwarded-For changes nothing", () => {
  const h = new Headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" });
  assert.equal(clientKey(h), "203.0.113.7");
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4" })), "local", "outside Cloudflare (local dev) everyone is one visitor");
});
