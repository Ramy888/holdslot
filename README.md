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
Next.js on Render, Postgres, PayPal sandbox (Vault v3, Orders v2 AUTHORIZE, Payments v2 void/capture, webhooks), Claude (Anthropic API), Bryntum Scheduler.

The PayPal REST client (`lib/paypal.mjs`) is copied from the author's other entry, CollectPilot. Everything else is new.

## Run locally
```sh
npm install
cp .env.example .env      # fill in the PayPal sandbox app, Postgres and the owner passcode
npm run migrate           # creates tables and the demo business
npm run dev               # http://localhost:3000
npm test                  # unit tests; set TEST_DATABASE_URL for the Postgres end-to-end tests
```

`npm run verify:sandbox -- start` checks the PayPal money loop (vault → authorize → partial capture / void) on your sandbox app.

## License
MIT
