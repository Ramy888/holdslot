import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-md flex-1 content-center justify-items-start gap-4 px-4 py-20">
        <LogoMark size={44} />
        <h1 className="font-display text-3xl font-semibold tracking-tight">This page isn&apos;t on the calendar.</h1>
        <p className="text-muted">The link may be old or mistyped. Booking links look like /b/ followed by a short code.</p>
        <Link href="/" className="btn btn-primary">
          Back to HoldSlot
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
