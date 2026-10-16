import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "HoldSlot · Deposits that only hold",
  description: "An AI receptionist for salons, clinics and tutors that holds a PayPal deposit instead of charging it.",
};

const STEPS = [
  ["Book by chat", "Claude books the slot in plain English or Arabic, from real free times only."],
  ["Score the risk", "First visit, past no-shows, late cancels, Friday-evening slots. Regulars never see a deposit."],
  ["Approve once, pay nothing", "A risky client approves PayPal once, capped at the no-show fee. Nothing is charged."],
  ["Hold 48 hours before", "HoldSlot places a PayPal authorization. The hold shows on the studio's calendar."],
  ["Settle at the slot", "Client arrives: the hold is voided. No-show: the fee is captured. Late cancel: part of it, the rest released."],
] as const;

// Public landing page: what HoldSlot is, and the two ways in (client and front desk).
export default function Home() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-10 px-4 py-12">
      <header className="grid gap-3">
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-md bg-plum font-display text-[17px] text-white">
          H
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">A deposit that only holds.</h1>
        <p className="max-w-2xl text-lg text-muted">
          No-shows cost salons, clinics and tutors 10–20% of their revenue. Charging everyone a deposit loses bookings; charging nobody loses money. HoldSlot is an AI
          receptionist that asks only risky bookings for a PayPal hold, places it 48 hours before, and releases it the moment the client walks in.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/book" className="rounded-lg bg-plum px-5 py-3 text-sm font-semibold text-white">
            Book as a client
          </Link>
          <Link href="/desk" className="rounded-lg border border-line bg-card px-5 py-3 text-sm font-semibold">
            Open the studio&apos;s front desk
          </Link>
        </div>
        <p className="text-sm text-muted">Demo studio: Juniper Hair Studio, on the PayPal sandbox. The front desk passcode is in the hackathon testing instructions.</p>
      </header>

      <ol className="grid gap-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[2rem_1fr] gap-3 rounded-2xl border border-line bg-card p-4">
            <span className="font-display text-xl font-semibold text-plum">{i + 1}</span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted">
        Built on PayPal Vault, Orders (authorize) and Payments (void, capture), with Claude and a Bryntum Scheduler calendar. The owner writes the cancellation policy in
        plain English; Claude turns it into rules, and every money decision after that is plain code.
      </p>
    </main>
  );
}
