import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PolicyEditor } from "@/components/PolicyEditor";
import { getSettings } from "@/lib/server/db.mjs";
import { isOwner } from "@/lib/server/owner";

export const metadata: Metadata = { title: "Policy · HoldSlot" };

export default async function PolicyPage({ searchParams }: PageProps<"/policy">) {
  await connection();
  if (!(await isOwner())) redirect("/login");
  const settings = await getSettings();
  const saved = (await searchParams).saved;
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <Link href="/" className="text-sm underline">
          ← Front desk
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Cancellation policy</h1>
        <p className="text-muted">Write it the way you&apos;d tell a client. Claude turns it into rules; you check them. From then on every hold, release and charge follows these rules exactly; the AI never decides an amount.</p>
      </header>
      {saved && <p role="status" className="rounded-xl border border-released bg-released-soft px-4 py-3 text-sm text-released">Saved. New rules apply to every open booking.</p>}
      <PolicyEditor policyText={settings.policyText} rules={settings.rules} />
    </main>
  );
}
