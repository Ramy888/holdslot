import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { bookingActivity, getBookingByPublicId, getSettings } from "@/lib/server/db.mjs";
import { clockNow } from "@/lib/server/ops.mjs";
import { cancellationFee } from "@/lib/policy.mjs";
import { holdWhen } from "@/lib/lifecycle.mjs";
import { formatSlot } from "@/lib/slots.mjs";
import { STATUS, TONE_CLASS, usd } from "@/lib/statusCopy";
import { cancel } from "./actions";

export const metadata: Metadata = { title: "Your booking · HoldSlot", robots: { index: false } };

const PROBLEMS: Record<string, string> = {
  NOT_PENDING: "This booking doesn't need a PayPal approval any more.",
  NOT_OPEN: "This booking is already closed.",
  BUSY: "Too many attempts. Try again later.",
  PAYPAL_UNAVAILABLE: "PayPal didn't answer. Nothing was charged; please try again.",
};
const DONE: Record<string, string> = {
  approved: "PayPal approved. Nothing is charged now.",
  cancelled: "Your booking is cancelled.",
};

export default async function BookingPage({ params, searchParams }: PageProps<"/b/[publicId]">) {
  await connection();
  const { publicId } = await params;
  const sp = await searchParams;
  const b = await getBookingByPublicId(publicId);
  if (!b) notFound();
  const settings = await getSettings();
  const now = clockNow(settings);
  const activity = await bookingActivity(b.id);
  const status = STATUS[b.status] ?? STATUS.booked;
  const open = ["awaiting_approval", "booked", "held", "hold_failed"].includes(b.status);
  const cancelFee = open ? cancellationFee(settings.rules, { price: b.price, startAt: b.startAt, now }) : null;
  const feeFromHold = cancelFee && cancelFee.late && b.status === "held" ? Math.min(cancelFee.fee, b.holdAmount) : 0;
  const problem = PROBLEMS[String(sp.problem ?? "")];
  const done = DONE[String(sp.done ?? "")];

  return (
    <main className="mx-auto grid w-full max-w-xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <p className="text-sm font-medium uppercase tracking-wider text-plum">{settings.businessName}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{b.serviceName}</h1>
        <p className="text-lg">{formatSlot(b.startAt, settings.timeZone)}</p>
        <p className="text-sm text-muted">For {b.clientName} · {usd(b.price)}, paid at the studio</p>
      </header>

      {(done || problem || sp.cancelled) && (
        <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${problem ? TONE_CLASS.charged : TONE_CLASS.released}`}>
          {problem ?? done ?? "You left PayPal before approving. Your slot is kept until the appointment time; approve to confirm it."}
        </p>
      )}

      <section className={`grid gap-2 rounded-2xl border p-5 ${TONE_CLASS[status.tone]}`}>
        <p className="font-semibold">{status.label}</p>
        {b.status === "awaiting_approval" && (
          <>
            <p className="text-sm text-ink">
              This booking needs a deposit hold of up to <strong>{usd(b.holdAmount)}</strong>. Approve PayPal once: nothing is charged now. PayPal holds the amount{" "}
              {holdWhen(settings.rules, b.startAt, now)}; it&apos;s released when you arrive, and charged only if you miss the appointment.
            </p>
            <form action="/approve/start" method="post">
              <input type="hidden" name="booking" value={b.publicId} />
              <button className="mt-1 rounded-lg bg-[#ffc439] px-5 py-2.5 text-sm font-semibold text-[#111]">Approve with PayPal</button>
            </form>
          </>
        )}
        {b.status === "booked" && b.holdAmount > 0 && (
          <p className="text-sm text-ink">
            PayPal approved. {usd(b.holdAmount)} will be held (not charged) {holdWhen(settings.rules, b.startAt, now).replace("as soon as PayPal is approved", "in a moment")}.
          </p>
        )}
        {b.status === "held" && <p className="text-sm text-ink">{usd(b.holdAmount)} is on hold on your PayPal. It is released the moment you check in.</p>}
        {b.status === "charged" && <p className="text-sm text-ink">{usd(b.chargedAmount)} was charged under the studio&apos;s policy. The rest of any hold was released.</p>}
      </section>

      {open && cancelFee && (
        <section className="grid gap-2 rounded-2xl border border-line bg-card p-5">
          <h2 className="font-semibold">Can&apos;t make it?</h2>
          <p className="text-sm text-muted">
            {!cancelFee.late
              ? `Cancelling now is free (more than ${settings.rules.late_cancel_window_hours} hours before).`
              : feeFromHold > 0
                ? `It's ${cancelFee.hoursBefore} hours before, inside the ${settings.rules.late_cancel_window_hours}-hour window: cancelling now costs ${usd(feeFromHold)}, taken from the hold. The rest is released.`
                : `It's inside the ${settings.rules.late_cancel_window_hours}-hour window, but there's no hold on this booking, so cancelling costs nothing.`}
          </p>
          <form action={cancel}>
            <input type="hidden" name="booking" value={b.publicId} />
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">{feeFromHold > 0 ? `Cancel and pay ${usd(feeFromHold)}` : "Cancel booking"}</button>
          </form>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">What happened</h2>
        <ol className="grid gap-2">
          {activity.map((a, i) => (
            <li key={i} className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
              <span className="block text-xs text-muted">{formatSlot(a.at, settings.timeZone)}</span>
              {a.message}
            </li>
          ))}
        </ol>
      </section>
      <p className="text-xs text-muted">Policy: {settings.rules.summary}</p>
    </main>
  );
}
