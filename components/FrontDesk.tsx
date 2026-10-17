"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { CalBooking } from "./Calendar";
import { advance, checkInBooking, noShowBooking, reset, type ActionResult } from "@/app/actions";
import { STATUS, TONE_CLASS, usd } from "@/lib/statusCopy";

const Calendar = dynamic(() => import("./Calendar"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading calendar…</div> });

export type DeskBooking = CalBooking & {
  publicId: string;
  price: number;
  riskScore: number;
  riskReasons: string[];
  startLabel: string;
  authorizationId: string | null;
  captureId: string | null;
};
export type DeskActivity = { id: number; at: string; kind: string; message: string; amount: number | null; atLabel: string };

const KIND_TONE: Record<string, string> = {
  held: "text-held",
  released: "text-released",
  charged: "text-charged",
  no_show: "text-charged",
  hold_failed: "text-held",
  error: "text-charged",
};

export function FrontDesk({
  staff,
  bookings,
  activity,
  now,
  nowLabel,
  timeZone,
  totals,
}: {
  staff: { id: string; name: string }[];
  bookings: DeskBooking[];
  activity: DeskActivity[];
  now: string;
  nowLabel: string;
  timeZone: string;
  totals: { held: number; protected: number; charged: number };
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  // Live: polls a cheap change marker and refreshes the page when a booking, the activity
  // log or the demo clock moved (the sweep, a PayPal webhook, a client cancelling).
  useEffect(() => {
    let last: string | null = null;
    const tick = async () => {
      if (document.hidden) return;
      const res = await fetch("/api/changes", { cache: "no-store" }).catch(() => null);
      const mark = res?.ok ? (await res.json()).mark : null;
      if (mark && last && mark !== last) router.refresh();
      if (mark) last = mark;
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [router]);

  const act = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      router.refresh();
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section className="grid min-w-0 gap-3">
        <div className="card flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="mr-auto">
            <p className="eyebrow">Demo clock</p>
            <p className="font-semibold">{nowLabel}</p>
          </div>
          {[
            ["+3 hours", 3],
            ["+1 day", 24],
          ].map(([label, h]) => (
            <button key={label} disabled={pending} onClick={() => act(() => advance(h as number))} className="btn btn-secondary min-h-10 px-3 py-2">
              {label}
            </button>
          ))}
          <button disabled={pending} onClick={() => act(reset)} className="btn min-h-10 px-3 py-2 font-medium text-muted underline">
            Reset demo
          </button>
        </div>
        <div className="card h-[clamp(420px,64vh,640px)] overflow-hidden">
          {/* Remount when the demo clock moves: Bryntum doesn't redraw cleanly when its time span jumps (e.g. Reset demo). */}
          <Calendar key={now} staff={staff} bookings={bookings} now={now} timeZone={timeZone} onSelect={setSelectedId} />
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Tile label="On hold now" value={usd(totals.held)} tone="text-held" />
          <Tile label="Fees collected" value={usd(totals.charged)} tone="text-charged" />
          <Tile label="Holds released" value={String(totals.protected)} tone="text-released" />
        </dl>
        {error && (
          <p role="alert" className="text-sm text-charged">
            {error}
          </p>
        )}
      </section>

      <aside className="grid content-start gap-4">
        {selected ? (
          <>
            {/* Phones and tablets: the details open as a bottom sheet over the calendar, so a tap shows something right where you are. */}
            <button aria-label="Close details" onClick={() => setSelectedId(null)} className="fixed inset-0 z-40 bg-ink/30 lg:hidden" />
            <div
              role="dialog"
              aria-label={`${selected.clientName}'s booking`}
              className="card grid gap-3 p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[80vh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:p-5 max-lg:pb-8 max-lg:shadow-2xl"
            >
              <span aria-hidden className="mx-auto -mt-2 h-1 w-10 rounded-full bg-line lg:hidden" />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-xl font-semibold">{selected.clientName}</p>
                  <p className="text-sm text-muted">
                    {selected.serviceName} · {selected.startLabel} · {usd(selected.price)}
                  </p>
                </div>
                <button onClick={() => setSelectedId(null)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-paper">
                  ✕
                </button>
              </div>
              <p className={`rounded-lg border px-3 py-2 text-sm font-medium ${TONE_CLASS[STATUS[selected.status]?.tone ?? "neutral"]}`}>
                {STATUS[selected.status]?.label ?? selected.status}
              </p>
              <p className="text-sm">
                <span className="font-medium">{selected.riskTier[0].toUpperCase() + selected.riskTier.slice(1)} risk</span> ({selected.riskScore}/100): {selected.riskReasons.join(", ")}.
              </p>
              {selected.authorizationId && (
                <p className="break-all text-xs text-muted">
                  PayPal authorization {selected.authorizationId}
                  {selected.captureId ? ` · capture ${selected.captureId}` : ""}
                </p>
              )}
              {["booked", "held", "hold_failed"].includes(selected.status) && (
                <div className="flex flex-wrap gap-2">
                  <button disabled={pending} onClick={() => act(() => checkInBooking(selected.id))} className="btn flex-1 bg-released text-white sm:flex-none">
                    Checked in
                  </button>
                  <button disabled={pending} onClick={() => act(() => noShowBooking(selected.id))} className="btn flex-1 border border-charged bg-card text-charged sm:flex-none">
                    No-show
                  </button>
                </div>
              )}
              <a href={`/b/${selected.publicId}`} target="_blank" className="text-sm underline">
                Client&apos;s view
              </a>
            </div>
          </>
        ) : null}
        {
          <div className={`grid gap-2 rounded-2xl border border-dashed border-plum/30 bg-plum-soft/50 px-4 py-3 text-sm ${selected ? "lg:hidden" : ""}`}>
            <p className="font-semibold">Try it</p>
            <ol className="grid list-decimal gap-1 pl-5 text-muted">
              <li>Click a booking to see why it does or doesn&apos;t need a deposit.</li>
              <li>
                Press <b>+3 hours</b> or <b>+1 day</b>: holds go on 48 hours before a slot, and a slot nobody checks in to is charged after the grace period.
              </li>
              <li>Check a client in before their slot: the PayPal hold is released.</li>
              <li>
                Book as a new client in the{" "}
                <a href="/book" target="_blank" className="underline">
                  booking chat
                </a>
                .
              </li>
            </ol>
          </div>
        }
        <div className="grid gap-2">
          <h2 className="eyebrow">What HoldSlot did</h2>
          <ol className="grid max-h-[520px] gap-2 overflow-y-auto">
            {activity.map((a) => (
              <li key={a.id} className="card rounded-xl px-3 py-2.5 text-sm shadow-none">
                <span className={`block text-xs font-medium ${KIND_TONE[a.kind] ?? "text-muted"}`}>
                  {a.kind.replace(/_/g, " ")} · {a.atLabel}
                </span>
                {a.message}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="card min-w-0 px-3 py-3 sm:px-4">
      <dt className="text-[11px] leading-tight font-semibold tracking-wide text-muted uppercase sm:text-xs">{label}</dt>
      <dd className={`font-display text-xl font-semibold tabular-nums sm:text-2xl ${tone}`}>{value}</dd>
    </div>
  );
}
