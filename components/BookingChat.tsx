"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";

type Msg = { role: "user" | "assistant"; content: string; choices?: string[] };
type Booked = {
  publicId: string;
  when: string;
  service: string;
  needsApproval: boolean;
  holdAmount: number;
  holdWhen: string;
  riskTier: string;
};

// Minimal typing for the browser's speech recognition (Chrome/Safari prefix it).
type Recognition = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

export function BookingChat({ businessName, starters = [] }: { businessName: string; starters?: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Hi! I'm the front desk at ${businessName}. What would you like to book, and when?`,
      choices: starters,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [lang, setLang] = useState<"en-US" | "ar-EG">("en-US");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    // Feature detection has to run in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanListen(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  // Scroll the message list only, never the page (scrollIntoView would jump the page on phones).
  // Braces matter: an effect must not return a value React would call as its cleanup.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
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
      // Only the words go back to the server; the chips were for this page.
      const history = next.map(({ role, content }) => ({ role, content }));
      res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history }) });
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
      setMessages([...next, { role: "assistant", content: json.reply, choices: Array.isArray(json.choices) ? json.choices : [] }]);
      if (json.booking) setBooked(json.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) return rec.current?.stop();
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.onresult = (e) =>
      send(
        Array.from(e.results)
          .map((x) => x[0].transcript)
          .join(" "),
      );
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  // Quick replies belong to the latest receptionist message only; anything typed or tapped replaces them.
  const last = messages.at(-1);
  const chips = last?.role === "assistant" && !booked && !busy ? (last.choices ?? []) : [];

  return (
    <div className="grid min-w-0 gap-4">
      <section className="card flex flex-col overflow-hidden" aria-label="Booking chat">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <LogoMark size={36} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{businessName} front desk</p>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-released" /> AI receptionist · books real free times only
            </p>
          </div>
        </div>

        <div ref={listRef} className="grid h-[min(56vh,520px)] min-h-[300px] content-start gap-3 overflow-y-auto bg-paper/60 p-4" aria-live="polite">
          {messages.map((m, i) => (
            <p
              key={i}
              dir="auto"
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "justify-self-end rounded-br-md bg-plum text-white" : "justify-self-start rounded-bl-md border border-line bg-card"}`}
            >
              {m.content}
            </p>
          ))}
          {busy && (
            <p className="flex items-center gap-2 justify-self-start rounded-2xl rounded-bl-md border border-line bg-card px-4 py-2.5 text-sm text-muted">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-plum" />
              Checking the calendar…
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="border-t border-charged/30 bg-charged-soft px-4 py-2.5 text-sm text-charged">
            {error}
          </p>
        )}

        {chips.length > 0 && (
          <div aria-label="Quick replies" className="flex gap-2 overflow-x-auto border-t border-line px-3 pt-3 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_88%,transparent)]">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                dir="auto"
                onClick={() => send(c)}
                className="shrink-0 rounded-full border border-plum/30 bg-plum-soft px-3.5 py-2 text-sm font-medium whitespace-nowrap text-plum transition-colors hover:border-plum hover:bg-plum hover:text-white"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className={`flex flex-wrap items-center gap-2 p-3 ${chips.length > 0 ? "" : "border-t border-line"}`}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            dir="auto"
            placeholder={lang === "ar-EG" ? "اكتب هنا…" : "A haircut on Friday after 5?"}
            aria-label="Message"
            className="min-h-11 min-w-0 flex-1 basis-48 rounded-xl border border-line bg-paper px-4 py-2.5 focus:border-plum focus:outline-none"
            maxLength={2000}
          />
          <div className="flex gap-2">
            {canListen && (
              <>
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-pressed={listening}
                  className={`btn min-h-11 border px-3 ${listening ? "border-charged bg-charged-soft text-charged" : "btn-secondary"}`}
                >
                  {listening ? "Listening…" : "🎙 Speak"}
                </button>
                <button type="button" onClick={() => setLang(lang === "en-US" ? "ar-EG" : "en-US")} className="btn btn-secondary min-h-11 px-3" aria-label="Voice language">
                  {lang === "en-US" ? "EN" : "عربي"}
                </button>
              </>
            )}
            <button disabled={busy || !input.trim()} className="btn btn-primary min-h-11 px-5">
              Send
            </button>
          </div>
        </form>
      </section>

      {booked && (
        <div className={`grid gap-2 rounded-2xl border p-5 ${booked.needsApproval ? "border-held bg-held-soft" : "border-released bg-released-soft"}`}>
          <p className="font-display text-lg font-semibold">
            {booked.service}, {booked.when}
          </p>
          {booked.needsApproval ? (
            <p className="text-sm">
              One step left: approve PayPal so the studio can hold up to <strong>{usd(booked.holdAmount)}</strong> {booked.holdWhen}. Nothing is charged, and the hold is released
              when you arrive.
            </p>
          ) : (
            <p className="text-sm">You&apos;re booked. No deposit needed.</p>
          )}
          <Link href={`/b/${booked.publicId}`} className="btn btn-primary justify-self-start">
            {booked.needsApproval ? "Approve with PayPal" : "See my booking"}
          </Link>
        </div>
      )}
    </div>
  );
}
