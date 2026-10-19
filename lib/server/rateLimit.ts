// The app's limits live in the database (lib/server/limits.mjs) so they hold across every
// Worker copy, and count visitors by Cloudflare's CF-Connecting-IP.
export { allow, clientKey } from "./limits.mjs";
