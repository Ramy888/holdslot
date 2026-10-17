import { usd } from "@/lib/statusCopy";

// Small line icons; colour comes from the parent's text colour.
const PATHS = {
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4",
  pause: "M10 5v14M14 5v14",
  check: "M20 6 9 17l-5-5",
  coin: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3 6.5h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v2m0 9v1",
  x: "M18 6 6 18M6 6l12 12",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5v5l3 2",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

type Step = { at: Date; kind: string; message: string; amount: number | null };

// What each logged event looks like on the timeline: icon, colour, and a two-word label.
function look(s: Step, holdAmount: number): { icon: IconName; tone: string; label: string } {
  switch (s.kind) {
    case "booked":
      return { icon: "calendar", tone: "text-plum", label: "Booked" };
    case "approved":
      return { icon: "shield", tone: "text-plum", label: "PayPal approved" };
    case "held":
      return { icon: "pause", tone: "text-held", label: `${usd(s.amount ?? holdAmount)} held` };
    case "released":
      return { icon: "check", tone: "text-released", label: "Hold released" };
    case "charged":
      return { icon: "coin", tone: "text-charged", label: s.amount ? `${usd(s.amount)} charged` : "Charged" };
    case "no_show":
      return { icon: "x", tone: "text-charged", label: "No-show" };
    case "cancelled":
      return { icon: "x", tone: "text-muted", label: "Cancelled" };
    case "expired":
      return { icon: "clock", tone: "text-muted", label: "Expired" };
    // PayPal's webhook confirming what HoldSlot just did.
    case "paypal_authorization_created":
    case "paypal_authorization_voided":
    case "paypal_capture_completed":
    case "paypal_capture_refunded":
      return { icon: "shield", tone: "text-released", label: "PayPal confirmed" };
    case "hold_failed":
      return { icon: "alert", tone: "text-held", label: "Hold declined" };
    case "error":
    case "paypal_capture_denied":
      return { icon: "alert", tone: "text-charged", label: "Problem" };
    default:
      return { icon: "check", tone: "text-muted", label: "Update" };
  }
}

const shortDate = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

/** Horizontal history of one booking. The full sentence for each step is its tooltip and screen-reader text. */
export function BookingTimeline({ steps, holdAmount, timeZone, next }: { steps: Step[]; holdAmount: number; timeZone: string; next?: { label: string; at: Date } }) {
  const items = [
    ...steps.map((s) => ({ ...look(s, holdAmount), at: s.at, message: s.message, ghost: false })),
    ...(next ? [{ icon: "calendar" as IconName, tone: "text-muted", label: next.label, at: next.at, message: next.label, ghost: true }] : []),
  ];
  return (
    <ol aria-label="What happened" className="card flex overflow-x-auto px-2 py-4">
      {items.map((it, i) => (
        <li key={i} title={it.message} className="relative grid min-w-[6.5rem] flex-1 justify-items-center gap-1.5 px-1 text-center">
          {i > 0 && <span aria-hidden className={`absolute top-[1.125rem] right-1/2 left-[-50%] border-t-2 ${it.ghost ? "border-dashed border-line" : "border-line"}`} />}
          <span className={`relative grid h-9 w-9 place-items-center rounded-full border bg-card ${it.ghost ? "border-dashed border-line" : "border-line"} ${it.tone}`}>
            <Icon name={it.icon} />
          </span>
          <span className={`text-xs leading-tight font-semibold ${it.ghost ? "text-muted" : ""}`}>{it.label}</span>
          <span className="text-[11px] leading-tight text-muted">{shortDate(it.at, timeZone)}</span>
          <span className="sr-only">{it.message}</span>
        </li>
      ))}
    </ol>
  );
}
