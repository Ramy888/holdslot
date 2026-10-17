import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

// Header and footer shared by every screen. `nav` replaces the default links (the front desk passes its own).
export function SiteHeader({ nav, wide = false }: { nav?: ReactNode; wide?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur">
      <div className={`mx-auto flex w-full ${wide ? "max-w-7xl" : "max-w-5xl"} items-center gap-3 px-4 py-3 sm:px-6`}>
        <Logo />
        <nav className="ml-auto flex items-center gap-1 text-sm font-medium sm:gap-2">
          {nav ?? (
            <>
              <Link href="/book" className="rounded-lg px-3 py-2 hover:bg-plum-soft">
                Book
              </Link>
              <Link href="/desk" className="btn btn-secondary min-h-0 py-2">
                Front desk
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted sm:px-6">
        <span>HoldSlot · PayPal sandbox demo</span>
        <span>Built with PayPal Vault, Orders and Payments, Claude, and Bryntum Scheduler</span>
      </div>
    </footer>
  );
}
