// Day-1 sandbox check for HoldSlot's money loop. Reads PayPal credentials from .env.
//   npm run verify:sandbox -- start            → prints a PayPal approval link (log in as the sandbox BUYER)
//   npm run verify:sandbox -- finish <setupId> → vaults the account, then hold → partial capture,
//                                                hold → void, hold → reauthorize, and prints a pass/fail table
//   add --keep to keep the vaulted account and print it as DEMO_VAULT_ID for the seeded demo clients
import { randomUUID } from "node:crypto";
import { createPayPalClient } from "../lib/paypal.mjs";
import { placeHold, releaseHold, captureHold } from "../lib/holds.mjs";

const { PAYPAL_API_BASE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
if (!PAYPAL_API_BASE?.includes("sandbox") || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Set PAYPAL_API_BASE (sandbox), PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.");
  process.exit(1);
}
const paypal = createPayPalClient({ apiBase: PAYPAL_API_BASE, clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_CLIENT_SECRET });
const [cmd, arg] = process.argv.slice(2).filter((a) => a !== "--keep");
const keep = process.argv.includes("--keep");
const results = [];
async function step(name, fn) {
  try {
    const out = await fn();
    results.push({ step: name, ok: "PASS", detail: out ?? "" });
    return out;
  } catch (err) {
    results.push({ step: name, ok: "FAIL", detail: String(err.message ?? err) });
    return null;
  }
}

if (cmd === "start") {
  const st = await paypal.request("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: "HoldSlot sandbox check: up to 25 USD only if you miss an appointment",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: true,
        experience_context: { brand_name: "HoldSlot", return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" },
      },
    },
  });
  console.log(`Setup token: ${st.id}\nApprove as the sandbox buyer:\n${st.links?.find((l) => l.rel === "approve")?.href}\nThen: npm run verify:sandbox -- finish ${st.id}`);
} else if (cmd === "finish" && arg) {
  const pt = await step("vault: setup token → payment token", async () => {
    const r = await paypal.request("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: arg, type: "SETUP_TOKEN" } } });
    return r.id;
  });
  if (pt) {
    const hold = (amount, tag) => placeHold({ paypal, vaultId: pt, amount, bookingRef: `verify-${tag}`, description: `HoldSlot check ${tag}`, requestId: randomUUID() });
    const a = await step("AUTHORIZE from vault_id ($25)", async () => {
      const h = await hold(25, "a");
      return `${h.authorizationId} ${h.status} expires ${h.expiresAt}`;
    });
    if (a) await step("partial capture $10 (final_capture releases $15)", async () => {
      const c = await captureHold({ paypal, authorizationId: a.split(" ")[0], amount: 10, note: "Late cancel fee", requestId: randomUUID() });
      return `${c.captureId} ${c.status} $${c.amount}`;
    });
    const b = await step("second AUTHORIZE ($25)", async () => (await hold(25, "b")).authorizationId);
    if (b) await step("void (client came)", async () => {
      await releaseHold({ paypal, authorizationId: b, requestId: randomUUID() });
      const r = await paypal.request("GET", `/v2/payments/authorizations/${b}`);
      return r.status;
    });
    const c = await step("third AUTHORIZE ($25)", async () => (await hold(25, "c")).authorizationId);
    if (c) {
      await step("reauthorize (expected to fail inside the 3-day honor period)", async () => {
        const r = await paypal.request("POST", `/v2/payments/authorizations/${c}/reauthorize`, { amount: { currency_code: "USD", value: "25.00" } });
        return `${r.id} ${r.status}`;
      });
      await step("void the third hold (cleanup)", async () => releaseHold({ paypal, authorizationId: c, requestId: randomUUID() }));
    }
    if (!keep) await step("delete vaulted token (cleanup)", async () => paypal.request("DELETE", `/v3/vault/payment-tokens/${pt}`));
  }
  console.table(results);
  if (keep && pt) console.log(`\nKept the vaulted account. Put this in .env (and as a Worker secret) for the demo clients:\nDEMO_VAULT_ID=${pt}`);
} else {
  console.error("Usage: verify:sandbox -- start | finish <setupTokenId>");
  process.exit(1);
}
