// PayPal webhooks: verify the signature, then turn authorization and capture events
// into "PayPal confirmed ..." lines on the booking. Bookings change state in the sweep,
// not here; the webhook is PayPal's receipt for what HoldSlot did.

export const MAX_BODY = 1_000_000;
const SIG_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

const CONFIRM = {
  "PAYMENT.AUTHORIZATION.CREATED": (amt) => `PayPal confirmed the ${amt} hold.`,
  "PAYMENT.AUTHORIZATION.VOIDED": () => "PayPal confirmed the hold was released.",
  "PAYMENT.CAPTURE.COMPLETED": (amt) => `PayPal confirmed ${amt} was collected.`,
  "PAYMENT.CAPTURE.DENIED": (amt) => `PayPal denied the ${amt} charge.`,
  "PAYMENT.CAPTURE.REFUNDED": (amt) => `PayPal confirmed ${amt} was refunded.`,
};

/** The authorization a payment event belongs to, and the line to log. Null for other events. */
export function describeEvent(event) {
  const make = CONFIRM[event.event_type];
  if (!make) return null;
  const r = event.resource ?? {};
  const authorizationId = event.event_type.startsWith("PAYMENT.AUTHORIZATION.") ? r.id : r.supplementary_data?.related_ids?.authorization_id;
  if (!authorizationId) return null;
  const amt = r.amount?.value ? `$${Number(r.amount.value).toFixed(2).replace(/\.00$/, "")}` : "the";
  return { authorizationId, message: make(amt), kind: `paypal_${event.event_type.split(".").slice(1).join("_").toLowerCase()}` };
}

/** @returns {Promise<{ status: number, body: object, event?: any }>} */
export async function verifyWebhook({ headers, rawBody, webhookId, paypal }) {
  if (!webhookId) return { status: 503, body: { error: "webhook id not configured" } };
  if (SIG_HEADERS.some((h) => !headers[h])) return { status: 400, body: { error: "missing PayPal signature headers" } };
  if (Buffer.byteLength(rawBody) > MAX_BODY) return { status: 413, body: { error: "body too large" } };
  if (!(await paypal.verifyWebhookSignature({ headers, rawBody, webhookId }))) return { status: 401, body: { error: "signature not verified" } };
  return { status: 200, body: { ok: true }, event: JSON.parse(rawBody) };
}
