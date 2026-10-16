"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { CalBooking } from "./Calendar";
import { advance, checkInBooking, noShowBooking, reset, type ActionResult } from "@/app/actions";
import { STATUS, TONE_CLASS, usd } from "@/lib/statusCopy";

const Calendar = dynamic(() => import("./Calendar"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading calendar…</div> });

export type DeskBooking = CalBooking & { publicId: string; price: number; riskScore: number; riskReasons: string[]; startLabel: string; authorizationId: string | null; captureId: string | null };
export type DeskActivity = { id: number; at: string; kind: string; message: string; amount: number | null; atLabel: string };

const KIND_TONE: Record<string, string> = { held: "text-held", released: "text-released", charged: "text-charged", no_show: "text-charged", hold_failed: "text-held", error: "text-charged" };

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

  // Live: any booking change (sweep, PayPal webhook, a client cancelling) refreshes the page data.
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = () => router.refresh();
    return () => es.close();
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
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card px-4 py-3">
          <div className="mr-auto">
            <p className="text-xs uppercase tracking-wider text-muted">Demo clock</p>
            <p className="font-semibold">{nowLabel}</p>
          </div>
          {[
            ["+3 hours", 3],
            ["+1 day", 24],
          ].map(([label, h]) => (
            <button key={label} disabled={pending} onClick={() => act(() => advance(h as number))} className="rounded-lg border border-line px-3 py-2 text-sm font-medium disabled:opacity-50">
              {label}
            </button>
          ))}
          <button disabled={pending} onClick={() => act(reset)} className="rounded-lg px-3 py-2 text-sm text-muted underline disabled:opacity-50">
            Reset demo
          </button>
        </div>
        <div className="h-[560px] overflow-hidden rounded-2xl border border-line bg-card">
          <Calendar staff={staff} bookings={bookings} now={now} timeZone={timeZone} onSelect={setSelectedId} />
        </div>
        <dl className="grid grid-cols-3 gap-3">
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
          <div className="grid gap-3 rounded-2xl border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display text-xl font-semibold">{selected.clientName}</p>
                <p className="text-sm text-muted">
                  {selected.serviceName} · {selected.startLabel} · {usd(selected.price)}
                </p>
              </div>
              <button onClick={() => setSelectedId(null)} aria-label="Close" className="text-muted">
                ✕
              </button>
            </div>
            <p className={`rounded-lg border px-3 py-2 text-sm font-medium ${TONE_CLASS[STATUS[selected.status]?.tone ?? "neutral"]}`}>{STATUS[selected.status]?.label ?? selected.status}</p>
            <p className="text-sm">
              <span className="font-medium capitalize">{selected.riskTier} risk</span> ({selected.riskScore}/100): {selected.riskReasons.join(", ")}.
            </p>
            {selected.authorizationId && <p className="break-all text-xs text-muted">PayPal authorization {selected.authorizationId}{selected.captureId ? ` · capture ${selected.captureId}` : ""}</p>}
            {["booked", "held", "hold_failed"].includes(selected.status) && (
              <div className="flex flex-wrap gap-2">
                <button disabled={pending} onClick={() => act(() => checkInBooking(selected.id))} className="rounded-lg bg-released px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Checked in
                </button>
                <button disabled={pending} onClick={() => act(() => noShowBooking(selected.id))} className="rounded-lg border border-charged px-3 py-2 text-sm font-semibold text-charged disabled:opacity-50">
                  No-show
                </button>
              </div>
            )}
            <a href={`/b/${selected.publicId}`} target="_blank" className="text-sm underline">
              Client&apos;s view
            </a>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-muted">Click a booking to see its risk and act on it.</p>
        )}
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">What HoldSlot did</h2>
          <ol className="grid max-h-[520px] gap-2 overflow-y-auto">
            {activity.map((a) => (
              <li key={a.id} className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm">
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
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`font-display text-2xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}
