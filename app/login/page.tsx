import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isOwner } from "@/lib/server/owner";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in · HoldSlot" };

export default async function LoginPage() {
  if (await isOwner()) redirect("/");
  return (
    <main className="mx-auto grid min-h-full w-full max-w-sm content-center gap-6 px-4 py-16">
      <div className="grid gap-2">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-md bg-plum font-display text-[15px] text-white">
          H
        </span>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Front desk sign-in</h1>
        <p className="text-sm text-muted">For the studio owner. Clients book at <Link href="/book" className="underline">/book</Link>.</p>
      </div>
      <SignInForm />
    </main>
  );
}
