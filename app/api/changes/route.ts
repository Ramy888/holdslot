import { changeMark } from "@/lib/server/db.mjs";
import { isOwner } from "@/lib/server/owner";

export const dynamic = "force-dynamic";

// A marker that changes whenever a booking, the activity log or the demo clock changes.
export async function GET() {
  if (!(await isOwner())) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ mark: await changeMark() }, { headers: { "Cache-Control": "no-store" } });
}
