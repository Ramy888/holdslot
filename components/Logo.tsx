import Link from "next/link";

// The HoldSlot mark: an H whose crossbar is an amber clasp, the deposit that is held, not taken.
// Reads as a pause sign too. app/icon.svg is the same drawing.
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" width={size} height={size} className={className}>
      <rect width="32" height="32" rx="8" fill="var(--plum)" />
      <rect x="8" y="7" width="5" height="18" rx="2.5" fill="var(--paper)" />
      <rect x="19" y="7" width="5" height="18" rx="2.5" fill="var(--paper)" />
      <rect x="10.5" y="13.5" width="11" height="5" rx="2.5" fill="var(--clasp)" />
    </svg>
  );
}

export function Logo({ href = "/", size = 32 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5 rounded-lg" aria-label="HoldSlot home">
      <LogoMark size={size} />
      <span className="font-display text-[1.3rem] font-semibold tracking-tight">
        Hold<span className="text-plum">Slot</span>
      </span>
    </Link>
  );
}
