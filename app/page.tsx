import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

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

const MONEY = [
  ["bg-held", "Held", "Authorized on PayPal, not charged."],
  ["bg-released", "Released", "Voided the moment the client checks in."],
  ["bg-charged", "Charged", "Captured only on a no-show or late cancel."],
] as const;

// A still of one booking's life, drawn from the same colours the front desk uses.
function BookingStory() {
  const rows = [
    ["Fri 2:10 PM", "Booked by chat. Medium risk: first visit, Friday evening.", "text-muted", "bg-line"],
    ["Fri 2:12 PM", "PayPal approved, capped at $30. Nothing charged.", "text-plum", "bg-plum"],
    ["Wed 6:00 PM", "$30 held on PayPal, 48 hours before.", "text-held", "bg-held"],
    ["Fri 5:52 PM", "Checked in. Hold released, $0 charged.", "text-released", "bg-released"],
  ] as const;
  return (
    <div className="card relative grid gap-4 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Juniper Hair Studio</p>
          <p className="font-display text-xl font-semibold">Haircut · Fri 6:00 PM</p>
          <p className="text-sm text-muted">Sam Rivera · $60, paid at the studio</p>
        </div>
        <span className="shrink-0 rounded-full bg-released-soft px-3 py-1 text-xs font-semibold whitespace-nowrap text-released">$0 charged</span>
      </div>
      <ol className="grid gap-3 border-l-2 border-line pl-4">
        {rows.map(([when, what, tone, dot]) => (
          <li key={when} className="relative grid text-sm">
            <span aria-hidden className={`absolute top-1.5 -left-[1.3rem] h-2.5 w-2.5 rounded-full ring-4 ring-card ${dot}`} />
            <span className={`text-xs font-semibold ${tone}`}>{when}</span>
            <span>{what}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Public landing page: what HoldSlot is, and the two ways in (client and front desk).
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl gap-16 px-4 py-10 sm:px-6 sm:py-16">
        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
          <div className="grid gap-5">
            <p className="w-fit rounded-full bg-plum-soft px-3 py-1 text-xs font-semibold text-plum">AI receptionist · PayPal holds</p>
            <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
              A deposit that <span className="text-plum italic">only holds</span>.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              No-shows cost salons, clinics and tutors 10–20% of their revenue. HoldSlot asks only risky bookings for a PayPal hold, places it 48 hours before, and releases it the
              moment the client walks in.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/book" className="btn btn-primary px-6">
                Book as a client
              </Link>
              <Link href="/desk" className="btn btn-secondary px-6">
                Open the front desk
              </Link>
            </div>
            <p className="text-sm text-muted">Demo studio on the PayPal sandbox. The front desk passcode is in the hackathon testing instructions.</p>
          </div>
          <BookingStory />
        </section>

        <section className="grid gap-6">
          <div className="grid gap-2">
            <p className="eyebrow">How it works</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Five steps, one PayPal approval.</h2>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="card grid content-start gap-2 p-5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-plum-soft font-display text-lg font-semibold text-plum">{i + 1}</span>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted">{body}</p>
              </li>
            ))}
            <li className="grid content-start gap-3 rounded-2xl bg-plum p-5 text-white">
              <p className="font-semibold">Three colours, everywhere</p>
              <ul className="grid gap-2 text-sm">
                {MONEY.map(([dot, label, body]) => (
                  <li key={label} className="flex items-start gap-2.5">
                    <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70 ${dot}`} />
                    <span>
                      <b>{label}.</b> <span className="text-white/80">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          </ol>
        </section>

        <section className="card grid gap-3 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-6 sm:p-8">
          <p className="font-display text-2xl font-semibold tracking-tight">The AI reads. Code decides.</p>
          <p className="text-muted">
            The owner writes the cancellation policy in plain English; Claude turns it into rules the owner checks. Every hold, release and charge after that is plain code, never a
            model guessing an amount.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
