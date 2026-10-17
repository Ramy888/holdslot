import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isOwner } from "@/lib/server/owner";
import { LogoMark } from "@/components/Logo";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in · HoldSlot" };

export default async function LoginPage() {
  if (await isOwner()) redirect("/desk");
  return (
    <>
      <SiteHeader
        nav={
          <Link href="/book" className="rounded-lg px-3 py-2 hover:bg-plum-soft">
            Book
          </Link>
        }
      />
      <main className="mx-auto grid w-full max-w-sm flex-1 content-center gap-6 px-4 py-16">
        <div className="grid gap-3">
          <LogoMark size={44} />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Front desk sign-in</h1>
          <p className="text-sm text-muted">
            For the studio owner. Clients book at{" "}
            <Link href="/book" className="underline">
              /book
            </Link>
            .
          </p>
        </div>
        <SignInForm />
      </main>
      <SiteFooter />
    </>
  );
}
