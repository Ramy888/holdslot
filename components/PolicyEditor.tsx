"use client";

import { useActionState } from "react";
import { readPolicy, savePolicy, type ReadResult, type Rules } from "@/app/policy/actions";

const fee = (f: Rules["no_show_fee"]) => (f.kind === "percent" ? `${f.value}% of the service price` : `$${f.value}`);
const HOLD_FOR: Record<Rules["hold_for"], string> = {
  none: "Nobody",
  high: "High-risk bookings only",
  medium_and_high: "Medium- and high-risk bookings",
  everyone: "Every booking",
};

function RulesTable({ rules }: { rules: Rules }) {
  const rows: [string, string][] = [
    ["Missed appointment", fee(rules.no_show_fee)],
    ["Free cancellation until", `${rules.late_cancel_window_hours} hours before`],
    ["Late cancellation", fee(rules.late_cancel_fee)],
    ["Who gets a deposit hold", HOLD_FOR[rules.hold_for]],
    ["Grace period", `${rules.grace_minutes} minutes`],
  ];
  return (
    <dl className="card grid gap-px overflow-hidden bg-line text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 bg-card px-4 py-3 sm:grid-cols-[1fr_1.3fr] sm:gap-3">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PolicyEditor({ policyText, rules }: { policyText: string; rules: Rules }) {
  const [state, action, pending] = useActionState<ReadResult, FormData>(readPolicy, {});
  const text = state.text ?? policyText;
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h2 className="eyebrow">Rules in force</h2>
        <RulesTable rules={rules} />
      </section>
      <form action={action} className="grid gap-2">
        <label htmlFor="policy" className="eyebrow">
          Your policy, in your words
        </label>
        <textarea
          id="policy"
          name="policy"
          defaultValue={text}
          rows={8}
          maxLength={3000}
          dir="auto"
          className="card p-4 text-[15px] leading-relaxed shadow-none focus:border-plum focus:outline-none"
        />
        <button disabled={pending} className="btn btn-primary justify-self-start">
          {pending ? "Reading…" : "Read my policy"}
        </button>
        {state.error && (
          <p role="alert" className="text-sm text-charged">
            {state.error}
          </p>
        )}
      </form>
      {state.rules && (
        <form action={savePolicy} className="grid gap-3 rounded-2xl border border-held bg-held-soft p-4 sm:p-5">
          <p className="font-semibold">Here&apos;s how HoldSlot read it. Check it before saving.</p>
          <RulesTable rules={state.rules} />
          <p className="text-sm">Clients will see: “{state.rules.summary}”</p>
          {state.rules.unclear.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {state.rules.unclear.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          )}
          <input type="hidden" name="rules" value={JSON.stringify(state.rules)} />
          <input type="hidden" name="policy" value={text} />
          <button className="btn btn-primary justify-self-start">Use these rules</button>
        </form>
      )}
    </div>
  );
}
