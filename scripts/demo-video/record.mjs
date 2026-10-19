// Records the HoldSlot demo in headless Chrome against a running app (local dev: real AI
// receptionist and PayPal sandbox calls). Writes frames, list.txt and cues.json to <outDir>.
//
//   node --env-file=.env scripts/demo-video/record.mjs <baseUrl> <outDir>
//   ffmpeg -f concat -safe 0 -i list.txt -vf "scale=1920:1200,format=yuv420p" -r 30 -c:v libx264 -crf 18 holdslot.mp4
//
// REC_CAPTIONS=0: nothing is drawn on screen, but every beat is still timed in cues.json, so a
// voice-over script can be written to fit. The booking chat and the policy reader call the AI
// (about 6-8 calls per take). Waits for the AI and the server are cut from the video.
import { launch, sleep } from "./cdp.mjs";
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [B, DIR] = process.argv.slice(2);
if (!B || !DIR) throw new Error("usage: record.mjs <baseUrl> <outDir>");
if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET missing (run with --env-file=.env)");
const CARD = fileURLToPath(new URL("./card.html", import.meta.url));
const SHOW_CAPTIONS = process.env.REC_CAPTIONS !== "0";
// The owner's signed sign-in cookie, as lib/server/session.ts makes it.
const OWNER = "owner." + createHmac("sha256", process.env.SESSION_SECRET).update("owner").digest("base64url");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR + "/frames", { recursive: true });

const b = await launch({ width: 1440, height: 900, scale: 4 / 3, port: 9391 });
await b.send("Network.setCookie", { name: "hs_owner", value: OWNER, url: B });

const cues = [];
let lastCaption = "";
const caption = async (text) => {
  cues.push({ at: b.mark(), text });
  console.log(b.mark().toFixed(1), text);
  if (!SHOW_CAPTIONS) return;
  await b.evaluate(`(() => {
    document.querySelectorAll('nextjs-portal').forEach((e) => e.remove());
    let c = document.getElementById('rec-caption');
    if (!c) { c = document.createElement('div'); c.id = 'rec-caption';
      Object.assign(c.style, { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 2147483600, maxWidth: '1100px',
        background: 'rgba(42,23,48,.92)', color: '#fff', font: '600 22px/1.35 "Instrument Sans", system-ui, sans-serif', padding: '12px 22px',
        borderRadius: '14px', boxShadow: '0 10px 30px rgba(0,0,0,.25)', textAlign: 'center', pointerEvents: 'none', transition: 'opacity .3s' });
      document.documentElement.appendChild(c); }
    c.textContent = ${JSON.stringify(text)}; c.style.opacity = ${text ? 1 : 0};
  })()`);
};
const say = async (text) => { lastCaption = text; await caption(text); };
// After a navigation the caption must be drawn again; it is not a new beat.
const restoreCaption = async () => {
  await b.evaluate("document.querySelectorAll('nextjs-portal').forEach((e) => e.remove())");
  if (!SHOW_CAPTIONS || !lastCaption) return;
  await caption(lastCaption);
  cues.pop();
};
const hover = (x, y) => b.moveTo({ x, y });

// Centre of the target, and whether React is wired to it yet (Bryntum's own elements never are).
const rect = (js) => b.evaluate(`(() => { const e = ${js}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const q = e.getBoundingClientRect();
  const dom = /^(BUTTON|A|INPUT|TEXTAREA)$/.test(e.tagName);
  const react = !dom || Object.keys(e).some((k) => k.startsWith('__reactProps'));
  return { x: q.x + q.width / 2, y: q.y + Math.min(q.height / 2, 18), react, dom }; })()`);
const clickEl = async (js, label) => {
  let p;
  for (let i = 0; i < 60; i++) { p = await rect(js); if (p?.react) break; await sleep(250); }
  if (!p) { await b.shot(DIR + "/fail.png"); throw new Error("missing " + label); }
  if (!p.react) console.error("not hydrated:", label);
  if (p.dom) {
    // App controls: show the pointer and ripple, then activate the element itself (real
    // presses are sometimes dropped while frames are being captured).
    await b.moveTo(p);
    await b.evaluate(`(() => { const r = document.getElementById('rec-ripple'); if (!r) return; r.style.transition = 'none'; r.style.left = '${p.x}px'; r.style.top = '${p.y}px'; r.style.opacity = 1; r.style.transform = 'scale(.4)'; r.offsetWidth; r.style.transition = 'opacity .5s, transform .5s'; r.style.opacity = 0; r.style.transform = 'scale(1.6)'; })()`);
    await sleep(150);
    await b.evaluate(`(() => { const e = ${js}; if (/^(INPUT|TEXTAREA)$/.test(e.tagName)) e.focus(); else e.click(); })()`);
  } else await b.clickAt(p); // Bryntum calendar bars answer only to real pointer events
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0)`;
// React must be hydrated before a click does anything; wait for it off camera.
const hydrated = async () => {
  for (let i = 0; i < 80; i++) {
    if (await b.evaluate("[...document.querySelectorAll('button, a')].some((e) => Object.keys(e).some((k) => k.startsWith('__reactProps')))")) return;
    await sleep(250);
  }
};
const goto = async (url, wait = 4000) => { b.pause(); await b.goto(url, wait); await hydrated(); await sleep(800); await restoreCaption(); await b.resume(); };

// ---------- off camera: reset the demo studio, and run the hold sweep once ----------
await b.goto(B + "/desk", 7000); await hydrated();
await clickEl(byText("button", "Reset demo"), "Reset demo");
await sleep(5000);
// In production a cron runs the hold sweep every minute; run it once here so holds due now are placed.
const sw = await fetch(B + "/api/sweep", { method: "POST", headers: { "x-sweep-secret": process.env.SWEEP_SECRET ?? "" } });
console.error("sweep", sw.status);

// ---------- 1. landing ----------
await b.goto(B + "/", 3500); await hydrated();
await b.startRec();
await say("HoldSlot: an AI receptionist that holds a PayPal deposit instead of charging it");
await sleep(2500); await hover(980, 330); await sleep(2500); await hover(560, 330); await sleep(2000);
await say("Only risky bookings get a hold. It's placed 48 hours before, and released when the client walks in");
await b.evaluate("window.scrollBy({ top: 620, behavior: 'smooth' })"); await sleep(4500);

// ---------- 2. booking chat (real AI) ----------
await goto(B + "/book", 4000);
await say("A first-time client books by chat. The AI only offers times the calendar really has");
await sleep(2000);
const msgCount = () => b.evaluate("document.querySelectorAll('[aria-live=polite] > p[dir=auto]').length");
const waitReply = async (before) => {
  await sleep(1500); b.pause();
  for (let i = 0; i < 120; i++) { if (!(await b.evaluate("document.body.innerText.includes('Checking the calendar')")) && (await msgCount()) > before) break; await sleep(500); }
  await sleep(600); await restoreCaption(); await b.resume(); await sleep(2500);
};
const sendText = async (text) => {
  await clickEl(`document.querySelector('input[aria-label="Message"]')`, "message box");
  for (const ch of text) { await b.type(ch); await sleep(35); }
  await sleep(400);
  const before = await msgCount();
  await clickEl(byText("button", "Send"), "Send");
  await waitReply(before);
};
const tapChip = async (pick) => {
  const before = await msgCount();
  await clickEl(`[...document.querySelectorAll('[aria-label="Quick replies"] button')].find(${pick})`, "chip");
  await waitReply(before);
};
await tapChip("(e) => e.textContent.includes('Haircut')");
for (let turn = 0; turn < 6; turn++) {
  if (await b.evaluate("!!(" + byText("a", "Approve with PayPal") + " || " + byText("a", "See my booking") + ")")) break;
  const last = await b.evaluate("[...document.querySelectorAll('[aria-live=polite] > p[dir=auto]')].at(-1)?.innerText ?? ''");
  const chips = await b.evaluate("[...document.querySelectorAll('[aria-label=\"Quick replies\"] button')].map((e) => e.textContent)");
  console.error("TURN", turn, JSON.stringify(last.slice(0, 100)), JSON.stringify(chips));
  if (/name|email/i.test(last)) { await say("It asks only for what it needs"); await sendText("Sam Rivera, sam.rivera@example.com"); }
  else if (chips.length && !chips.some((c) => /\d:\d\d/.test(c))) { await say("The client asks in their own words"); await sendText("Friday evening, after 5pm"); }
  else if (chips.length) {
    const evening = chips.findIndex((c) => /\b([5-8]):\d\d\s?PM/i.test(c));
    const time = evening >= 0 ? evening : chips.findIndex((c) => /\d:\d\d|AM|PM/.test(c));
    await say("One tap picks a time");
    await tapChip(`(e, i) => i === ${time >= 0 ? time : 0}`);
  } else await sendText("Friday after 5pm please");
}
await say("New client, Friday evening: medium risk. One PayPal approval, capped at the fee. Nothing is charged");
await sleep(5500);

// ---------- 3. front desk ----------
await goto(B + "/desk", 7000);
await say("The studio's front desk: every booking is coloured by what happened to its money");
await sleep(3000); await hover(500, 520); await sleep(2000);
const SCROLLER = "[...document.querySelectorAll('.b-scheduler *')].find((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))";
const scrollCalTo = async (name) => {
  // the calendar remounts after the clock moves: wait until it has drawn its bars
  for (let i = 0; i < 60 && !(await b.evaluate("document.querySelectorAll('.b-sch-event').length > 0")); i++) await sleep(250);
  await sleep(500);
  const has = () => b.evaluate(`[...document.querySelectorAll('.b-sch-event')].some((e) => e.textContent.includes(${JSON.stringify(name)}))`);
  if (await has()) return;
  await b.evaluate(`(() => { const s = ${SCROLLER}; if (s) s.scrollTop = 0; })()`); await sleep(400);
  for (let i = 0; i < 24 && !(await has()); i++) { await b.evaluate(`(() => { const s = ${SCROLLER}; if (s) s.scrollTop += 200; })()`); await sleep(350); }
};
const event = (name) => `[...document.querySelectorAll('.b-sch-event')].find((e) => e.textContent.includes(${JSON.stringify(name)}))`;
// Open a booking's details: real click first; if the panel didn't open, send the pointer/mouse
// sequence to the bar itself (real clicks sometimes get lost while frames are being captured).
const openBooking = async (name) => {
  await scrollCalTo(name);
  await clickEl(event(name), name); await sleep(1200);
  const open = () => b.evaluate(`!![...document.querySelectorAll('[role=dialog], aside p')].find((e) => e.textContent.includes(${JSON.stringify(name)}) && e.getBoundingClientRect().width > 0)`);
  if (await open()) return;
  console.error("synthetic click:", name);
  await b.evaluate(`(() => { const e = ${event(name)}; const t = e.querySelector('.b-sch-event-content') ?? e; const q = t.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: q.x + 10, clientY: q.y + 10, button: 0 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...o, pointerId: 1, isPrimary: true }) : new MouseEvent(type, o)); })()`);
  await sleep(1200);
  if (!(await open())) { await b.shot(DIR + "/fail.png"); throw new Error("could not open " + name); }
};
await say("Marcus missed an appointment before, so his $80 hold is already on PayPal");
await openBooking("Marcus"); await sleep(3500);
const clock = () => b.evaluate("document.querySelector('p.eyebrow + p')?.textContent ?? ''");
const advanceBy = async (label) => {
  const before = await clock();
  await clickEl(byText("button", label), label); await sleep(1200); b.pause();
  for (let i = 0; i < 120 && (await clock()) === before; i++) await sleep(500);
  await sleep(2500); await restoreCaption(); await b.resume();
  console.error("CLOCK", before, "->", await clock());
};
await say("Jump the demo clock a day: Marcus never checks in, so the no-show fee is captured");
await advanceBy("+1 day");
await sleep(3500); await hover(1180, 560); await sleep(2500);
await say("Priya arrives: one tap voids her PayPal hold. She is never charged");
// Check-in opens 2 hours before the slot (Priya: 5:30 PM). Move the clock until it's inside that window.
const clockHours = async () => { const m = (await clock()).match(/(\d+):(\d\d)\s*(AM|PM)/); return m ? ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) + +m[2] / 60 : 0; };
for (let i = 0; i < 2 && (await clockHours()) < 15.5; i++) await advanceBy("+3 hours");
console.error("clock before check-in", await clock());
await openBooking("Priya"); await sleep(1200);
await clickEl(byText("button", "Checked in"), "Checked in");
b.pause(); await sleep(6000); await restoreCaption(); await b.resume();
await openBooking("Priya"); await sleep(4000);

// ---------- 4. the client's booking page ----------
const pub = await b.evaluate(`document.querySelector('a[href^="/b/"]')?.getAttribute('href')`);
if (pub) {
  await goto(B + pub, 4000);
  await say("The client's own page: what happened to the deposit, step by step");
  await sleep(5500);
}

// ---------- 5. policy in plain English (real AI) ----------
await goto(B + "/policy", 4000);
await say("The owner writes the policy in plain English. The AI turns it into rules; code applies them");
await sleep(2500);
await b.evaluate("window.scrollBy({ top: 360, behavior: 'smooth' })"); await sleep(1200);
await clickEl(`document.querySelector('#policy')`, "policy box");
await b.evaluate(`(() => { const t = document.querySelector('#policy'); t.select(); })()`);
for (const ch of "Missing an appointment costs $25. Cancel free until 48 hours before; after that it's half the price. Only ask risky new clients for a deposit. Allow 10 minutes late.") { await b.type(ch); await sleep(12); }
await sleep(800);
await clickEl(byText("button", "Read my policy"), "Read my policy");
await sleep(1200); b.pause();
for (let i = 0; i < 90 && !(await b.evaluate("document.body.innerText.includes('Use these rules')")); i++) await sleep(500);
await restoreCaption(); await b.resume();
await b.evaluate("window.scrollBy({ top: 520, behavior: 'smooth' })"); await sleep(2000);
await say("The owner checks the rules before they apply. The AI never decides an amount");
await sleep(5500);

// ---------- 6. end card ----------
b.pause(); await b.goto("file://" + CARD, 2500); await b.evaluate("document.getElementById('rec-cursor')?.remove()"); await b.resume();
lastCaption = "";
await caption("");
await sleep(5500);

const { frames, end } = await b.stopRec();
b.close();

const FPS = 30, start = frames[0].t, slots = Math.ceil((end - start) * FPS);
const list = []; let j = 0; const written = new Map();
for (let s = 0; s < slots; s++) {
  const t = start + s / FPS;
  while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
  if (!written.has(j)) { const name = `frames/${String(j).padStart(5, "0")}.jpg`; writeFileSync(DIR + "/" + name, Buffer.from(frames[j].data, "base64")); written.set(j, name); }
  list.push(`file '${written.get(j)}'`, `duration ${(1 / FPS).toFixed(6)}`);
}
list.push(list[list.length - 2]);
writeFileSync(DIR + "/list.txt", list.join("\n") + "\n");
writeFileSync(DIR + "/cues.json", JSON.stringify(cues.map((c) => ({ at: Math.max(0, c.at - start), text: c.text })), null, 1));
console.log(`frames ${frames.length}, length ${(end - start).toFixed(1)} s`);
