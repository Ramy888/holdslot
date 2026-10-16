import { chat, type ChatMessage } from "@/lib/server/receptionist";
import { allow } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

// The public booking chat. Each turn is a paid Claude call, so it is rate-limited
// per visitor and overall.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(`chat:${ip}`, 40, 60 * 60_000) || !allow("chat:all", 400, 24 * 60 * 60_000)) {
    return Response.json({ error: "The receptionist is busy. Please try again later." }, { status: 429 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "The receptionist is offline (no AI key configured)." }, { status: 503 });
  let history: ChatMessage[];
  try {
    const body = await req.json();
    history = (Array.isArray(body.history) ? body.history : []).map((m: ChatMessage) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }));
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const { reply, booking } = await chat(history);
    return Response.json({
      reply,
      booking: booking && { publicId: booking.publicId, when: booking.startLabel, service: booking.service.name, needsApproval: booking.needsApproval, holdAmount: booking.holdAmount, holdWhen: booking.holdWhen, riskTier: booking.risk.tier },
    });
  } catch (err) {
    console.error(JSON.stringify({ msg: "chat failed", error: String(err) }));
    return Response.json({ error: err instanceof Error && /keep|Say something/.test(err.message) ? err.message : "Something went wrong. Please try again." }, { status: 500 });
  }
}
