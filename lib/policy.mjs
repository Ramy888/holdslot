// The business's no-show policy. The owner writes it in plain English; Claude turns
// it into these rules once, the owner checks the result, and from then on every
// money decision is made by the deterministic functions below, never by the model.
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const DEFAULT_MODEL = "claude-opus-5-5";

const Fee = z.object({
  kind: z.enum(["percent", "fixed"]).describe("percent: of the service price. fixed: an amount in the business currency."),
  value: z.number().describe("The percent (0-100) or the fixed amount."),
});

export const RulesSchema = z.object({
  no_show_fee: Fee.describe("What a client pays when they miss the appointment without cancelling."),
  late_cancel_window_hours: z.number().describe("Cancelling at least this many hours before the slot is free. 0 if any cancel is free."),
  late_cancel_fee: Fee.describe("What a client pays when they cancel inside the window. Use percent 0 if late cancels are free."),
  hold_for: z
    .enum(["none", "high", "medium_and_high", "everyone"])
    .describe("Which clients get a deposit hold, by no-show risk. Default medium_and_high when the policy does not say."),
  grace_minutes: z.number().describe("How late a client may arrive before it counts as a no-show. Default 15."),
  summary: z.string().describe("One plain sentence a client would read at booking, in the policy's language."),
  unclear: z.array(z.string()).describe("Parts of the policy that were ambiguous and how you read them. Empty if none."),
});

export const DEFAULT_POLICY_TEXT =
  "If you miss your appointment without telling us, you pay half the price of the service. " +
  "You can cancel for free up to 24 hours before. Cancelling later costs 25% of the price. " +
  "We only hold a deposit for bookings that look risky. If you're more than 15 minutes late we may give your slot away.";

export const DEFAULT_RULES = Object.freeze({
  no_show_fee: { kind: "percent", value: 50 },
  late_cancel_window_hours: 24,
  late_cancel_fee: { kind: "percent", value: 25 },
  hold_for: "medium_and_high",
  grace_minutes: 15,
  summary: "Free cancellation up to 24 hours before; a missed appointment costs half the price.",
  unclear: [],
});

const SYSTEM = `You turn a small business's cancellation and no-show policy, written in plain English or Arabic, into structured rules.
Extract only what the policy says. Where it is silent, use the documented default and say so in "unclear".
Never make a fee larger than the policy states. Percent fees are of the service price.`;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Makes model output safe to act on: bounded numbers, a fee never above 100% of the price. */
export function normalizeRules(r) {
  const fee = (f) => ({
    kind: f?.kind === "fixed" ? "fixed" : "percent",
    value: f?.kind === "fixed" ? Math.round(clamp(f?.value, 0, 10_000) * 100) / 100 : clamp(f?.value, 0, 100),
  });
  return {
    no_show_fee: fee(r.no_show_fee),
    late_cancel_window_hours: clamp(Math.round(r.late_cancel_window_hours), 0, 24 * 14),
    late_cancel_fee: fee(r.late_cancel_fee),
    hold_for: ["none", "high", "medium_and_high", "everyone"].includes(r.hold_for) ? r.hold_for : "medium_and_high",
    grace_minutes: clamp(Math.round(r.grace_minutes), 0, 120),
    summary: String(r.summary ?? "").trim().slice(0, 300),
    unclear: (r.unclear ?? []).map(String).slice(0, 10),
  };
}

/** @param {{ anthropic: { messages: { parse: Function } }, text: string, model?: string }} input */
export async function compilePolicy({ anthropic, text, model = DEFAULT_MODEL }) {
  const input = String(text ?? "").trim();
  if (!input) throw new Error("Write your policy first.");
  if (input.length > 3000) throw new Error("Please keep the policy under 3,000 characters.");
  const response = await anthropic.messages.parse({
    model,
    max_tokens: 1500,
    output_config: { effort: "low", format: zodOutputFormat(RulesSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: input }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("The assistant could not read this policy.");
  return normalizeRules(response.parsed_output);
}

const cents = (n) => Math.round(n * 100) / 100;
const feeAmount = (fee, price) => cents(Math.min(fee.kind === "percent" ? (price * fee.value) / 100 : fee.value, price));

/** The amount held, and charged on a no-show. */
export const noShowFee = (rules, price) => feeAmount(rules.no_show_fee, price);

const TIERS_HELD = { none: [], high: ["high"], medium_and_high: ["medium", "high"], everyone: ["low", "medium", "high"] };
export const needsHold = (rules, tier, price) => TIERS_HELD[rules.hold_for].includes(tier) && noShowFee(rules, price) > 0;

/**
 * What a cancellation costs, decided only by the rules and the clock.
 * @returns {{ fee: number, late: boolean, hoursBefore: number }}
 */
export function cancellationFee(rules, { price, startAt, now }) {
  const hoursBefore = (new Date(startAt).getTime() - new Date(now).getTime()) / 3_600_000;
  const late = hoursBefore < rules.late_cancel_window_hours;
  return { fee: late ? feeAmount(rules.late_cancel_fee, price) : 0, late, hoursBefore: Math.round(hoursBefore * 10) / 10 };
}
