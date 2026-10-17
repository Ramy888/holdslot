import type { Metadata } from "next";
import { connection } from "next/server";
import { BookingChat } from "@/components/BookingChat";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getSettings, listServices } from "@/lib/server/db.mjs";

export const metadata: Metadata = { title: "Book · HoldSlot" };

export default async function BookPage() {
  await connection();
  const [settings, services] = await Promise.all([getSettings(), listServices()]);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[1fr_300px] lg:items-start">
        <header className="grid gap-1 lg:col-span-2">
          <p className="eyebrow text-plum">Book online</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{settings.businessName}</h1>
        </header>
        <BookingChat businessName={settings.businessName} />
        <aside className="grid gap-4 lg:sticky lg:top-24">
          <section className="card grid gap-3 p-5">
            <h2 className="eyebrow">Services</h2>
            <ul className="grid gap-2 text-sm">
              {services.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3">
                  <span>
                    {s.name} <span className="text-muted">· {s.durationMin} min</span>
                  </span>
                  <span className="font-semibold tabular-nums">${s.price}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2 rounded-2xl bg-plum-soft p-5 text-sm">
            <h2 className="eyebrow text-plum">Deposit policy</h2>
            <p>{settings.rules.summary}</p>
            <p className="text-muted">Most bookings need no deposit. If yours does, PayPal only holds it; nothing is charged unless you miss the slot.</p>
          </section>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
