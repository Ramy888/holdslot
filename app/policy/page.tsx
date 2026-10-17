import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PolicyEditor } from "@/components/PolicyEditor";
import { getSettings } from "@/lib/server/db.mjs";
import { isOwner } from "@/lib/server/owner";
import { SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Policy · HoldSlot" };

export default async function PolicyPage({ searchParams }: PageProps<"/policy">) {
  await connection();
  if (!(await isOwner())) redirect("/login");
  const settings = await getSettings();
  const saved = (await searchParams).saved;
  return (
    <>
      <SiteHeader
        wide
        nav={
          <Link href="/desk" className="btn btn-secondary min-h-0 py-2">
            ← Front desk
          </Link>
        }
      />
      <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-8 sm:py-12">
        <header className="grid gap-1">
          <p className="eyebrow text-plum">Settings</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Cancellation policy</h1>
          <p className="text-muted">
            Write it the way you&apos;d tell a client. Claude turns it into rules; you check them. From then on every hold, release and charge follows these rules exactly; the AI
            never decides an amount.
          </p>
        </header>
        {saved && (
          <p role="status" className="rounded-xl border border-released bg-released-soft px-4 py-3 text-sm text-released">
            Saved. New rules apply to every open booking.
          </p>
        )}
        <PolicyEditor policyText={settings.policyText} rules={settings.rules} />
      </main>
    </>
  );
}
