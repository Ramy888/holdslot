import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { bookingActivity, getBookingByPublicId, getSettings } from "@/lib/server/db.mjs";
import { clockNow } from "@/lib/server/ops.mjs";
import { cancellationFee } from "@/lib/policy.mjs";
import { holdWhen } from "@/lib/lifecycle.mjs";
import { formatSlot } from "@/lib/slots.mjs";
import { STATUS, usd, type Tone } from "@/lib/statusCopy";
import { BookingTimeline, Icon, type IconName } from "@/components/BookingTimeline";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { cancel } from "./actions";

export const metadata: Metadata = {
  title: "Your booking · HoldSlot",
  robots: { index: false },
};

const PROBLEMS: Record<string, string> = {
  NOT_PENDING: "This booking doesn't need a PayPal approval any more.",
  NOT_OPEN: "This booking is already closed.",
  STARTED: "Your appointment has already started, so it can't be cancelled online. Please talk to the studio.",
  BUSY: "Too many attempts. Try again later.",
  PAYPAL_UNAVAILABLE: "PayPal didn't answer. Nothing was charged; please try again.",
};
const TONE_TEXT: Record<Tone, string> = { held: "text-held", released: "text-released", charged: "text-charged", neutral: "text-plum", warn: "text-held" };
const STATUS_ICON: Record<string, IconName> = {
  awaiting_approval: "shield",
  booked: "calendar",
  held: "pause",
  released: "check",
  charged: "coin",
  cancelled: "x",
  no_show: "x",
  hold_failed: "alert",
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
  const cancelFee = open
    ? cancellationFee(settings.rules, {
        price: b.price,
        startAt: b.startAt,
        now,
      })
    : null;
  const started = new Date(b.startAt).getTime() <= now.getTime();
  const feeFromHold = cancelFee && cancelFee.late && b.status === "held" ? Math.min(cancelFee.fee, b.holdAmount) : 0;
  const problem = PROBLEMS[String(sp.problem ?? "")];
  const when = holdWhen(settings.rules, b.startAt, now);
  const statusLine =
    {
      awaiting_approval: `Approve PayPal once to confirm. Up to ${usd(b.holdAmount)} is held ${when}; nothing is charged unless you miss it.`,
      booked: b.holdAmount > 0 ? `${usd(b.holdAmount)} will be held ${when.replace("as soon as PayPal is approved", "in a moment")}. Nothing is charged.` : "No deposit needed. See you then.",
      held: `${usd(b.holdAmount)} is on hold, not charged. Released when you check in.`,
      released: b.holdAmount > 0 ? "Hold released. Nothing was charged." : "Thanks for coming in.",
      charged: `${usd(b.chargedAmount)} charged under the studio's policy. The rest was released.`,
      cancelled: "Nothing more to do.",
      no_show: "Marked as missed. Nothing was held, so nothing was charged.",
      hold_failed: "PayPal declined the hold. The studio may contact you.",
    }[b.status] ?? "";

  return (
    <>
      <SiteHeader nav={<span className="text-sm text-muted">Your booking</span>} />
      <main className="mx-auto grid w-full max-w-xl gap-5 px-4 py-8 sm:py-12">
        <header className="card grid gap-1 p-5 sm:p-6">
          <p className="eyebrow text-plum">{settings.businessName}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{b.serviceName}</h1>
          <p className="text-lg font-medium">{formatSlot(b.startAt, settings.timeZone)}</p>
          <p className="text-sm text-muted">
            For {b.clientName} · {usd(b.price)}, paid at the studio
          </p>
        </header>

        <BookingTimeline steps={activity} holdAmount={b.holdAmount} timeZone={settings.timeZone} next={open ? { label: "Appointment", at: new Date(b.startAt) } : undefined} />

        <section className="card grid gap-3 p-5">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 shrink-0 ${TONE_TEXT[status.tone]}`}>
              <Icon name={STATUS_ICON[b.status] ?? "calendar"} size={22} />
            </span>
            <div className="grid gap-0.5">
              <p className="font-semibold">{status.label}</p>
              <p className="text-sm text-muted">{statusLine}</p>
            </div>
          </div>
          {(problem || sp.cancelled) && (
            <p role="status" className="flex items-start gap-2 border-t border-line pt-3 text-sm">
              <span className={problem ? "text-charged" : "text-held"}>
                <Icon name="alert" size={16} />
              </span>
              {problem ?? "You left PayPal before approving. Your slot is kept until the appointment time; approve to confirm it."}
            </p>
          )}
          {b.status === "awaiting_approval" && (
            <form action="/approve/start" method="post">
              <input type="hidden" name="booking" value={b.publicId} />
              <button className="btn w-full bg-[#ffc439] text-[#111] hover:bg-[#f2b72c] sm:w-auto sm:px-8">Approve with PayPal</button>
            </form>
          )}
        </section>

        {open && cancelFee && !started && (
          <section className="card grid gap-3 p-5">
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
              <button className="btn btn-secondary hover:border-charged hover:text-charged">{feeFromHold > 0 ? `Cancel and pay ${usd(feeFromHold)}` : "Cancel booking"}</button>
            </form>
          </section>
        )}

        <p className="text-xs text-muted">Policy: {settings.rules.summary}</p>
      </main>
      <SiteFooter />
    </>
  );
}
