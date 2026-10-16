import { describeEvent, MAX_BODY, verifyWebhook } from "@/lib/webhook.mjs";
import { logActivity, pool } from "@/lib/server/db.mjs";
import { notify } from "@/lib/server/events.mjs";
import { paypal } from "@/lib/server/paypal";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  const result = await verifyWebhook({ headers: Object.fromEntries(req.headers), rawBody: await req.text(), webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "", paypal: paypal() });
  if (!result.event) return Response.json(result.body, { status: result.status });

  const event = result.event;
  const db = pool();
  const fresh = await db.query("INSERT INTO webhook_events (id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING", [event.id, event.event_type]);
  const info = fresh.rowCount ? describeEvent(event) : null;
  if (info) {
    const { rows } = await db.query("SELECT id FROM bookings WHERE authorization_id = $1", [info.authorizationId]);
    if (rows[0]) {
      await logActivity({ bookingId: rows[0].id, at: new Date(), kind: info.kind, message: info.message });
      notify({ type: "paypal", bookingId: rows[0].id });
    }
  }
  console.log(JSON.stringify({ msg: fresh.rowCount ? "webhook verified" : "webhook duplicate", id: event.id, event_type: event.event_type }));
  return Response.json(result.body, { status: 200 });
}
