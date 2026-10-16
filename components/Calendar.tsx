"use client";

// Bryntum Scheduler: one row per stylist, one bar per booking, coloured by what
// HoldSlot did with the money. Loaded client-side only (see FrontDesk).
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import { BryntumScheduler } from "@bryntum/scheduler-react";
import type { EventModel } from "@bryntum/scheduler";

export type CalBooking = {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  clientName: string;
  serviceName: string;
  status: string;
  holdAmount: number;
  chargedAmount: number;
  riskTier: string;
};

const COLORS: Record<string, string> = {
  awaiting_approval: "#b45309",
  booked: "#5b2a63",
  held: "#b45309",
  released: "#0f766e",
  charged: "#be123c",
  no_show: "#be123c",
  cancelled: "#9ca3af",
  hold_failed: "#b45309",
};

const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
function badge(b: { status: string; holdAmount: number; chargedAmount: number }) {
  if (b.status === "held") return `⏸ ${money(b.holdAmount)} held`;
  if (b.status === "charged") return `✕ ${money(b.chargedAmount)} charged`;
  if (b.status === "released") return b.holdAmount > 0 ? `✓ hold released` : "✓ came in";
  if (b.status === "awaiting_approval") return "needs PayPal OK";
  if (b.status === "hold_failed") return "hold declined";
  if (b.status === "no_show") return "no-show";
  if (b.status === "cancelled") return "cancelled";
  return b.holdAmount > 0 ? `${money(b.holdAmount)} hold due` : "no deposit";
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function Calendar({
  staff,
  bookings,
  now,
  timeZone,
  onSelect,
}: {
  staff: { id: string; name: string }[];
  bookings: CalBooking[];
  now: string;
  timeZone: string;
  onSelect: (id: string) => void;
}) {
  // Start a couple of hours before "now" (the demo clock), so the next appointments are in view.
  const start = new Date(new Date(now).getTime() - 2 * 3_600_000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return (
    <BryntumScheduler
      startDate={start}
      endDate={end}
      mode="vertical"
      viewPreset="hourAndDay"
      resourceColumns={{ columnWidth: 220, fillWidth: true }}
      timeZone={timeZone}
      workingTime={{ fromHour: 9, toHour: 19, fromDay: 0, toDay: 7 }}
      tickSize={64}
      barMargin={4}
      readOnly
      eventStyle="tonal"
      resources={staff}
      events={bookings.map((b) => ({
        id: b.id,
        resourceId: b.staffId,
        startDate: b.startAt,
        endDate: b.endAt,
        name: b.clientName,
        eventColor: COLORS[b.status] ?? "#5b2a63",
        cls: `hs-${b.status}`,
        service: b.serviceName,
        badge: badge(b),
      }))}
      timeRanges={[{ id: "now", startDate: new Date(now), name: "Now", cls: "hs-now" }]}
      timeRangesFeature={{ showHeaderElements: true }}
      eventRenderer={({ eventRecord }: { eventRecord: EventModel }) => {
        const e = eventRecord as EventModel & { get(f: string): string };
        return `<div class="hs-ev"><b>${esc(e.name)}</b><span class="hs-badge">${esc(e.get("badge"))}</span><span>${esc(e.get("service"))}</span></div>`;
      }}
      eventTooltipFeature={{ template: ({ eventRecord }: { eventRecord: EventModel & { get(f: string): string } }) => `${esc(eventRecord.name)} · ${esc(eventRecord.get("service"))}<br>${esc(eventRecord.get("badge"))}` }}
      onEventClick={({ eventRecord }: { eventRecord: EventModel }) => onSelect(String(eventRecord.id))}
    />
  );
}
