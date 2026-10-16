import type { Metadata } from "next";
import { connection } from "next/server";
import { BookingChat } from "@/components/BookingChat";
import { getSettings, listServices } from "@/lib/server/db.mjs";

export const metadata: Metadata = { title: "Book · HoldSlot" };

export default async function BookPage() {
  await connection();
  const [settings, services] = await Promise.all([getSettings(), listServices()]);
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-10">
      <header className="grid gap-2">
        <p className="text-sm font-medium uppercase tracking-wider text-plum">Book online</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">{settings.businessName}</h1>
        <p className="text-muted">
          {services.map((s) => `${s.name} $${s.price}`).join(" · ")}
        </p>
        <p className="text-sm text-muted">{settings.rules.summary}</p>
      </header>
      <BookingChat businessName={settings.businessName} />
    </main>
  );
}
