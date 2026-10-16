// Plain-language status for clients and the owner, and the colour it is shown in.
export type Tone = "held" | "released" | "charged" | "neutral" | "warn";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_approval: { label: "Waiting for PayPal approval", tone: "warn" },
  booked: { label: "Booked", tone: "neutral" },
  held: { label: "Deposit held, not charged", tone: "held" },
  released: { label: "Came in · hold released", tone: "released" },
  charged: { label: "Fee charged", tone: "charged" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No-show (nothing held)", tone: "charged" },
  hold_failed: { label: "PayPal declined the hold", tone: "warn" },
};

export const TONE_CLASS: Record<Tone, string> = {
  held: "bg-held-soft text-held border-held",
  released: "bg-released-soft text-released border-released",
  charged: "bg-charged-soft text-charged border-charged",
  neutral: "bg-paper text-ink border-line",
  warn: "bg-held-soft text-held border-held",
};

export const usd = (n: number) => `$${Number(n).toFixed(2).replace(/\.00$/, "")}`;
