// The deposit hold on PayPal: a vaulted PayPal account is authorized for the
// no-show fee shortly before the slot, then the authorization is voided (the
// client came), captured in full (no-show) or captured in part (late cancel).
// `paypal` is the REST client from lib/paypal.mjs.

const money = (amount, currency) => ({ currency_code: currency, value: Number(amount).toFixed(2) });

export class HoldError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Authorizes `amount` on the client's vaulted PayPal account. Nothing is charged yet.
 * `requestId` makes a retry safe: PayPal returns the same order for the same id.
 * @returns {Promise<{ orderId: string, authorizationId: string, status: string, expiresAt: string | null }>}
 */
export async function placeHold({ paypal, vaultId, amount, currency = "USD", bookingRef, description, requestId }) {
  const order = await paypal.request(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: bookingRef,
          custom_id: bookingRef,
          description: description?.slice(0, 127),
          amount: money(amount, currency),
        },
      ],
      payment_source: { paypal: { vault_id: vaultId } },
    },
    { headers: { "PayPal-Request-Id": requestId } },
  );
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new HoldError("NO_AUTHORIZATION", `PayPal did not authorize the hold (order ${order.status ?? "unknown"}).`);
  if (auth.status !== "CREATED" && auth.status !== "PENDING") {
    throw new HoldError("DECLINED", `PayPal authorization is ${auth.status}.`);
  }
  return { orderId: order.id, authorizationId: auth.id, status: auth.status, expiresAt: auth.expiration_time ?? null };
}

/** Releases the hold: the client came. PayPal answers 204 with no body. */
export async function releaseHold({ paypal, authorizationId, requestId }) {
  await paypal.request("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, {
    headers: { "PayPal-Request-Id": requestId },
  });
}

/**
 * Captures `amount` (all or part of the hold) and releases the rest: final_capture
 * closes the authorization so the remainder is never taken.
 * @returns {Promise<{ captureId: string, status: string, amount: number }>}
 */
export async function captureHold({ paypal, authorizationId, amount, currency = "USD", note, requestId }) {
  const cap = await paypal.request(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { amount: money(amount, currency), final_capture: true, note_to_payer: note?.slice(0, 255) },
    { headers: { "PayPal-Request-Id": requestId } },
  );
  if (!cap.id) throw new HoldError("NO_CAPTURE", "PayPal did not return a capture.");
  return { captureId: cap.id, status: cap.status, amount: Number(cap.amount?.value ?? amount) };
}
