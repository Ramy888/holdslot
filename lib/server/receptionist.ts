import { receptionistTurn, systemPrompt, RECEPTIONIST_MODEL } from "@/lib/receptionist.mjs";
import { clockNow, createBooking, findSlots } from "@/lib/server/ops.mjs";
import { getSettings, listServices } from "@/lib/server/db.mjs";
import { localDate } from "@/lib/slots.mjs";
import { anthropic } from "./anthropic";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One client turn against the live calendar. */
export async function chat(history: ChatMessage[]) {
  const settings = await getSettings();
  const now = clockNow(settings);
  const system = systemPrompt({
    businessName: settings.businessName,
    today: localDate(now, settings.timeZone),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone, weekday: "long" }).format(now),
    timeZone: settings.timeZone,
    policySummary: settings.rules.summary,
  });
  return receptionistTurn({
    anthropic: anthropic(),
    model: process.env.RECEPTIONIST_MODEL || RECEPTIONIST_MODEL,
    system,
    history,
    tools: {
      listServices: () => listServices(),
      findSlots: ({ serviceId, date }: { serviceId: string; date: string }) =>
        findSlots({ serviceId, date }).then((slots) => slots.map((s) => ({ staff_id: s.staffId, stylist: s.staffName, start_at: s.startAt, label: s.label }))),
      book: (args: { serviceId: string; staffId: string; startAt: string; name: string; email: string }) => createBooking({ ...args, source: "chat" }),
    },
  });
}
