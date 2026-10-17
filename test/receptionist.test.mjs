import { test } from "node:test";
import assert from "node:assert/strict";
import { receptionistTurn } from "../lib/receptionist.mjs";

// Scripted model: returns the queued responses in order and records what it was sent.
function fakeAnthropic(responses) {
  const sent = [];
  return { sent, messages: { create: async (req) => { sent.push(structuredClone(req)); return responses.shift(); } } };
}
const toolUse = (id, name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const text = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

test("finds slots, books, and reports the PayPal approval to the model", async () => {
  const anthropic = fakeAnthropic([
    toolUse("t1", "find_slots", { service_id: "cut", date: "2026-10-23" }),
    toolUse("t2", "book", { service_id: "cut", staff_id: "maya", start_at: "2026-10-23T21:00:00.000Z", name: "Sam", email: "sam@example.com" }),
    text("You're booked for Friday at 5pm."),
  ]);
  const booked = [];
  const tools = {
    listServices: async () => [],
    findSlots: async (a) => [{ staffId: "maya", startAt: "2026-10-23T21:00:00.000Z", label: "Fri, Oct 23, 5:00 PM", args: a }],
    book: async (a) => { booked.push(a); return { startLabel: "Fri 5pm", service: { name: "Haircut" }, needsApproval: true, holdAmount: 30 }; },
  };
  const out = await receptionistTurn({ anthropic, system: "s", history: [{ role: "assistant", content: "Hi!" }, { role: "user", content: "Haircut Friday 5pm, Sam, sam@example.com" }], tools });
  assert.equal(out.reply, "You're booked for Friday at 5pm.");
  assert.equal(out.booking.holdAmount, 30);
  assert.deepEqual(booked[0], { serviceId: "cut", staffId: "maya", startAt: "2026-10-23T21:00:00.000Z", name: "Sam", email: "sam@example.com" });
  assert.equal(anthropic.sent[0].messages[0].role, "user", "leading assistant greeting dropped");
  const lastResult = anthropic.sent[2].messages.at(-1).content[0];
  assert.match(lastResult.content, /"paypal_approval_needed":true/);
});

test("a failing tool goes back to the model as an error, not a crash", async () => {
  const anthropic = fakeAnthropic([toolUse("t1", "book", { service_id: "cut", staff_id: "maya", start_at: "x", name: "A", email: "a@example.com" }), text("That time is gone.")]);
  const tools = { book: async () => { throw new Error("That slot was just taken."); } };
  const out = await receptionistTurn({ anthropic, system: "s", history: [{ role: "user", content: "book it" }], tools });
  assert.equal(out.booking, null);
  const res = anthropic.sent[1].messages.at(-1).content[0];
  assert.equal(res.is_error, true);
  assert.match(res.content, /taken/);
});

test("rejects an empty or assistant-last history", async () => {
  await assert.rejects(receptionistTurn({ anthropic: fakeAnthropic([]), system: "s", history: [{ role: "assistant", content: "hi" }], tools: {} }));
});

test("markdown emphasis is stripped from replies", async () => {
  const anthropic = fakeAnthropic([text("Booked for **5:00 PM with Leo**.")]);
  const out = await receptionistTurn({ anthropic, system: "s", history: [{ role: "user", content: "hi" }], tools: {} });
  assert.equal(out.reply, "Booked for 5:00 PM with Leo.");
});

test("a trailing Choices line becomes tap-to-send options and leaves the reply", async () => {
  const anthropic = fakeAnthropic([text("Leo has these times on Friday.\nChoices: Fri 5:00 PM | Fri 5:30 PM |  | Fri 5:00 PM | Another day")]);
  const out = await receptionistTurn({ anthropic, system: "s", history: [{ role: "user", content: "haircut friday" }], tools: {} });
  assert.equal(out.reply, "Leo has these times on Friday.");
  assert.deepEqual(out.choices, ["Fri 5:00 PM", "Fri 5:30 PM", "Another day"], "blank and duplicate options dropped");
});

test("no Choices line, or a malformed one, means no options", async () => {
  const one = await receptionistTurn({ anthropic: fakeAnthropic([text("What's your name and email?")]), system: "s", history: [{ role: "user", content: "5pm" }], tools: {} });
  assert.deepEqual(one.choices, []);
  const long = await receptionistTurn({ anthropic: fakeAnthropic([text(`Pick one.\nChoices: ${"x".repeat(80)}`)]), system: "s", history: [{ role: "user", content: "hi" }], tools: {} });
  assert.equal(long.reply, "Pick one.");
  assert.deepEqual(long.choices, [], "over-long options are not shown as chips");
});
