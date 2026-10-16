import { timingSafeEqual } from "node:crypto";
import { runSweep } from "@/lib/server/ops.mjs";
import { paypal } from "@/lib/server/paypal";

export const dynamic = "force-dynamic";

// Called once a minute by the Cloudflare cron trigger (worker.ts) to place holds that are
// due and settle slots whose grace period passed. Needs SWEEP_SECRET.
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.SWEEP_SECRET ?? "");
  const given = Buffer.from(req.headers.get("x-sweep-secret") ?? "");
  if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const done = await runSweep({ paypal: paypal() });
  return Response.json({ ok: true, actions: done.length });
}
