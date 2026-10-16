# HoldSlot

**An AI receptionist for appointment businesses that holds a deposit instead of charging it.**
Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

No-shows cost salons, clinics and tutors 10-20% of their revenue. Charging every client a deposit up front loses bookings; asking nobody loses money. HoldSlot does neither:

1. **Book by chat.** Claude books the slot in plain English (or Arabic).
2. **Score the risk.** A transparent points score (first visit, past no-shows, late cancels, far-ahead or Friday-evening slots) decides whether this booking needs a deposit at all. Regulars never see one.
3. **Approve once, pay nothing.** A risky client approves PayPal once (PayPal Vault), capped at the no-show fee. Nothing is charged.
4. **Hold only when it matters.** 48 hours before the slot, HoldSlot places a PayPal **authorization** (Orders API, `intent: AUTHORIZE`, from the vaulted account). The hold appears on the calendar.
5. **Settle at the slot.** Client arrives: the authorization is **voided**. No-show after the grace period: the fee is **captured**. Late cancel: a **partial capture** under the policy, the rest released.
6. **Policy in plain English.** The owner writes the cancellation policy in their own words; Claude turns it into rules the owner checks. Every money decision after that is deterministic code, never the model.

## Stack
Next.js on Cloudflare Workers (OpenNext), Cloudflare D1 (SQLite), a Cloudflare cron trigger for the once-a-minute hold sweep, PayPal sandbox (Vault v3, Orders v2 AUTHORIZE, Payments v2 void/capture, webhooks), Claude (Anthropic API), Bryntum Scheduler.

The PayPal REST client (`lib/paypal.mjs`) is copied from the author's other entry, CollectPilot. Everything else is new.

## Run locally
```sh
npm install
cp .env.example .env      # fill in the PayPal sandbox app, Claude key and the owner passcode
npm run db:migrate:local  # creates the tables in Wrangler's local D1
npm run dev               # http://localhost:3000 (the demo business is created on first load)
npm test                  # unit + end-to-end tests (Node's built-in SQLite, same SQL as D1)
```

Deploy to Cloudflare: `npm run db:migrate`, then `npm run cf:deploy`. Set the secrets listed in `wrangler.jsonc` with `wrangler secret put` first. To trigger the hold sweep locally, open `http://localhost:8787/cdn-cgi/local/scheduled` while `npm run cf:preview` runs.

`npm run verify:sandbox -- start` checks the PayPal money loop (vault → authorize → partial capture / void) on your sandbox app.

## Demo data
The first page load (and **Reset demo** on the front desk) creates Juniper Hair Studio: two stylists, four services, and a week of bookings from five made-up clients (`@example.com`) with different histories, so the risk score has something to work with.

So judges can watch real PayPal holds without approving PayPal themselves, the seeded clients who "approved PayPal" all share **one sandbox buyer's vaulted account**, set as `DEMO_VAULT_ID`. Create it once with `npm run verify:sandbox -- start`, approve the link as the sandbox buyer, then `npm run verify:sandbox -- finish <setupTokenId> --keep`. Every hold, release and charge on those bookings is a real sandbox PayPal call; only the client histories are invented. New bookings made in the chat go through the normal one-time PayPal approval.

Use **+3 hours** and **+1 day** to move the demo clock: holds go on 48 hours before a slot, and a slot nobody checks in to is settled 15 minutes after it starts.

## License
MIT
