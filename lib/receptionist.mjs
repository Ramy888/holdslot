// The booking receptionist: Claude talks to the client and books through three
// tools. It can only offer slots the calendar returns and can't set any price or
// fee; risk and deposits are decided by code after `book` is called.

export const RECEPTIONIST_MODEL = "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 6;
const MAX_TURNS = 30;

const TOOLS = [
  {
    name: "list_services",
    description: "The services the business offers, with duration and price.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_slots",
    description: "Open start times for a service on one day, in the business's time zone. Call it before offering any time.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["service_id", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "book",
    description: "Books a slot returned by find_slots. Only call after the client chose the time and gave their name and email.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        staff_id: { type: "string" },
        start_at: { type: "string", description: "startAt exactly as find_slots returned it" },
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["service_id", "staff_id", "start_at", "name", "email"],
      additionalProperties: false,
    },
  },
];

export function systemPrompt({ businessName, today, weekday, timeZone, policySummary }) {
  return `You are the front-desk receptionist for ${businessName}, a hair studio. Today is ${weekday} ${today} (${timeZone}).
Book appointments through the tools. Keep replies short and warm: two or three sentences, plain text (no markdown, no asterisks).
- Reply in the client's language (English or Arabic).
- Offer only times that find_slots returned, at most four at once. Never invent a time, price, stylist or fee.
- Before calling book, you need: the service, a chosen time, the client's name and email. Ask for what's missing.
- After book succeeds, tell the client the booking is confirmed. If the result says a PayPal approval is needed, explain in one sentence that nothing is charged: PayPal holds the fee (hold_when says when) and releases it when they arrive. The page shows the button.
- The cancellation policy, if asked: ${policySummary}
- You can't cancel or change bookings in chat; the confirmation page has a cancel button.`;
}

/**
 * Runs one client turn. `history` is the visible conversation: [{ role: "user"|"assistant", content: string }].
 * `tools` implements list_services / find_slots / book against the real calendar.
 * @returns {Promise<{ reply: string, booking: { publicId: string, startLabel: string, service: { name: string }, needsApproval: boolean, holdAmount: number, holdWhen: string, risk: { tier: string } } | null }>}
 */
export async function receptionistTurn({ anthropic, model = RECEPTIONIST_MODEL, system, history, tools }) {
  const turns = history.slice(-MAX_TURNS).filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content).trim());
  if (!turns.length || turns.at(-1).role !== "user") throw new Error("Say something first.");
  if (turns.some((m) => String(m.content).length > 2000)) throw new Error("Please keep messages under 2,000 characters.");
  // The API needs the conversation to open with the client.
  while (turns[0]?.role === "assistant") turns.shift();
  const messages = turns.map((m) => ({ role: m.role, content: String(m.content) }));

  let booking = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await anthropic.messages.create({ model, max_tokens: 800, system, tools: TOOLS, messages });
    if (res.stop_reason !== "tool_use") {
      // Plain text is asked for; strip stray markdown emphasis in case the model slips.
      const reply = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").replace(/\*\*(.+?)\*\*/g, "$1").trim();
      return { reply: reply || "Sorry, could you say that again?", booking };
    }
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const call of res.content.filter((c) => c.type === "tool_use")) {
      let out;
      try {
        if (call.name === "list_services") out = await tools.listServices();
        else if (call.name === "find_slots") out = await tools.findSlots({ serviceId: call.input.service_id, date: call.input.date });
        else if (call.name === "book") {
          if (booking) throw new Error("A booking was already made in this turn.");
          booking = await tools.book({ serviceId: call.input.service_id, staffId: call.input.staff_id, startAt: call.input.start_at, name: call.input.name, email: call.input.email });
          out = { confirmed: true, when: booking.startLabel, service: booking.service.name, paypal_approval_needed: booking.needsApproval, hold_amount: booking.holdAmount, hold_when: booking.holdWhen };
        } else throw new Error(`Unknown tool ${call.name}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: String(err.message ?? err), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "Sorry, I got stuck finding that. Could you tell me the service and day again?", booking };
}
