// Tells open calendars that something changed, over Server-Sent Events.
// One app instance on Render, so an in-process subscriber list is enough.
const subscribers = (globalThis.__holdslotSubscribers ??= new Set());

export function notify(event) {
  const e = { ...event, at: new Date().toISOString() };
  for (const fn of subscribers) fn(e);
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
