// Runs the hold sweep once a minute per server process: places holds that are due,
// and settles slots whose grace period has passed.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL || !process.env.PAYPAL_CLIENT_ID || process.env.SWEEP === "off") return;
  const g = globalThis as typeof globalThis & { __holdslotSweep?: NodeJS.Timeout };
  if (g.__holdslotSweep) return;
  const { runSweep } = await import("./lib/server/ops.mjs");
  const { paypal } = await import("./lib/server/paypal");
  g.__holdslotSweep = setInterval(() => {
    runSweep({ paypal: paypal() }).catch((err: unknown) => console.error(JSON.stringify({ msg: "sweep failed", error: String(err) })));
  }, 60_000);
}
