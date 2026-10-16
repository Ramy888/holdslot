import { describeEvent, MAX_BODY, verifyWebhook } from "@/lib/webhook.mjs";
import { bookingIdForAuthorization, logActivity, recordWebhook } from "@/lib/server/db.mjs";
import { paypal } from "@/lib/server/paypal";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  const result = await verifyWebhook({ headers: Object.fromEntries(req.headers), rawBody: await req.text(), webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "", paypal: paypal() });
  if (!result.event) return Response.json(result.body, { status: result.status });

  const event = result.event;
  const fresh = await recordWebhook({ id: event.id, eventType: event.event_type });
  const info = fresh ? describeEvent(event) : null;
  const bookingId = info && (await bookingIdForAuthorization(info.authorizationId));
  if (info && bookingId) await logActivity({ bookingId, at: new Date(), kind: info.kind, message: info.message });
  console.log(JSON.stringify({ msg: fresh ? "webhook verified" : "webhook duplicate", id: event.id, event_type: event.event_type }));
  return Response.json(result.body, { status: 200 });
}
