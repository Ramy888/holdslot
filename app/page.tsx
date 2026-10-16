import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { FrontDesk } from "@/components/FrontDesk";
import { getSettings, listBookings, listStaff, recentActivity } from "@/lib/server/db.mjs";
import { clockNow } from "@/lib/server/ops.mjs";
import { formatSlot } from "@/lib/slots.mjs";
import { isOwner } from "@/lib/server/owner";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Front desk · HoldSlot" };

export default async function FrontDeskPage() {
  await connection();
  if (!(await isOwner())) redirect("/login");
  const settings = await getSettings();
  const now = clockNow(settings);
  const [staff, bookings, activity] = await Promise.all([
    listStaff(),
    listBookings({ from: new Date(now.getTime() - 2 * 86_400_000), to: new Date(now.getTime() + 8 * 86_400_000) }),
    recentActivity(40),
  ]);
  const tz = settings.timeZone;
  const iso = (d: Date | string) => new Date(d).toISOString();
  const totals = {
    held: bookings.filter((b) => b.status === "held").reduce((s, b) => s + b.holdAmount, 0),
    charged: bookings.reduce((s, b) => s + b.chargedAmount, 0),
    protected: bookings.filter((b) => b.status === "released" && b.holdAmount > 0).length,
  };
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-md bg-plum font-display text-[15px] text-white">
          H
        </span>
        <div className="mr-auto">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{settings.businessName}</h1>
          <p className="text-sm text-muted">HoldSlot holds a deposit only when a booking looks risky, and only 48 hours before.</p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/book" className="underline">
            Booking chat
          </Link>
          <Link href="/policy" className="underline">
            Policy
          </Link>
          <form action={signOut}>
            <button className="text-muted underline">Sign out</button>
          </form>
        </nav>
      </header>
      <FrontDesk
        staff={staff}
        now={iso(now)}
        nowLabel={formatSlot(now, tz)}
        timeZone={tz}
        totals={totals}
        bookings={bookings.map((b) => ({
          id: b.id,
          publicId: b.publicId,
          staffId: b.staffId,
          startAt: iso(b.startAt),
          endAt: iso(b.endAt),
          startLabel: formatSlot(b.startAt, tz),
          clientName: b.clientName,
          serviceName: b.serviceName,
          status: b.status,
          price: b.price,
          holdAmount: b.holdAmount,
          chargedAmount: b.chargedAmount,
          riskTier: b.riskTier,
          riskScore: b.riskScore,
          riskReasons: b.riskReasons,
          authorizationId: b.authorizationId,
          captureId: b.captureId,
        }))}
        activity={activity.map((a) => ({ id: a.id, at: iso(a.at), atLabel: formatSlot(a.at, tz), kind: a.kind, message: a.message, amount: a.amount }))}
      />
    </main>
  );
}
