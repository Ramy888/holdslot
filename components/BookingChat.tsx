"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type Booked = { publicId: string; when: string; service: string; needsApproval: boolean; holdAmount: number; holdWhen: string; riskTier: string };

// Minimal typing for the browser's speech recognition (Chrome/Safari prefix it).
type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type RecognitionCtor = new () => Recognition;

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

export function BookingChat({ businessName }: { businessName: string }) {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: `Hi! I'm the front desk at ${businessName}. What would you like to book, and when?` }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [lang, setLang] = useState<"en-US" | "ar-EG">("en-US");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    // Feature detection has to run in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanListen(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would try
  // to call an effect's return value as its cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history: next }) });
    } catch {
      // The connection dropped before any answer. Not retried automatically: the first try may
      // have booked. Give the message back so one tap resends it.
      setMessages(messages);
      setInput(content);
      setError("The connection dropped before the receptionist answered. Your message is back in the box: press Send to try again.");
      setBusy(false);
      return;
    }
    try {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setMessages([...next, { role: "assistant", content: json.reply }]);
      if (json.booking) setBooked(json.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) return rec.current?.stop();
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.onresult = (e) => send(Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  return (
    <div className="grid gap-4">
      <div className="grid max-h-[60vh] min-h-[320px] content-start gap-3 overflow-y-auto rounded-2xl border border-line bg-card p-4" aria-live="polite">
        {messages.map((m, i) => (
          <p
            key={i}
            dir="auto"
            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "justify-self-end bg-plum text-white" : "justify-self-start bg-paper"}`}
          >
            {m.content}
          </p>
        ))}
        {busy && <p className="justify-self-start rounded-2xl bg-paper px-4 py-2.5 text-sm text-muted">Checking the calendar…</p>}
        <div ref={end} />
      </div>

      {booked && (
        <div className={`grid gap-2 rounded-2xl border p-4 ${booked.needsApproval ? "border-held bg-held-soft" : "border-released bg-released-soft"}`}>
          <p className="font-display text-lg font-semibold">
            {booked.service}, {booked.when}
          </p>
          {booked.needsApproval ? (
            <p className="text-sm">
              One step left: approve PayPal so the studio can hold up to <strong>{usd(booked.holdAmount)}</strong> {booked.holdWhen}. Nothing is charged, and the hold is released when you arrive.
            </p>
          ) : (
            <p className="text-sm">You&apos;re booked. No deposit needed.</p>
          )}
          <Link href={`/b/${booked.publicId}`} className="justify-self-start rounded-lg bg-plum px-4 py-2 text-sm font-semibold text-white">
            {booked.needsApproval ? "Approve with PayPal" : "See my booking"}
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-charged">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          dir="auto"
          placeholder={lang === "ar-EG" ? "اكتب هنا…" : "A haircut on Friday after 5?"}
          aria-label="Message"
          className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3"
          maxLength={2000}
        />
        {canListen && (
          <>
            <button type="button" onClick={toggleMic} aria-pressed={listening} className={`rounded-xl border px-3 py-3 text-sm font-medium ${listening ? "border-charged bg-charged-soft text-charged" : "border-line bg-card"}`}>
              {listening ? "Listening…" : "🎙 Speak"}
            </button>
            <button type="button" onClick={() => setLang(lang === "en-US" ? "ar-EG" : "en-US")} className="rounded-xl border border-line bg-card px-3 py-3 text-sm" aria-label="Voice language">
              {lang === "en-US" ? "EN" : "عربي"}
            </button>
          </>
        )}
        <button disabled={busy || !input.trim()} className="rounded-xl bg-plum px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}
