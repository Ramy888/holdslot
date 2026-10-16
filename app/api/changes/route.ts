import { pool } from "@/lib/server/db.mjs";
import { isOwner } from "@/lib/server/owner";

export const dynamic = "force-dynamic";

// A marker that changes whenever a booking, the activity log or the demo clock changes.
export async function GET() {
  if (!(await isOwner())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { rows } = await pool().query(
    `SELECT (SELECT coalesce(max(id), 0) FROM activity) || ':' ||
            (SELECT coalesce(extract(epoch FROM max(updated_at))::text, '0') FROM bookings) || ':' ||
            (SELECT clock_offset_ms FROM settings WHERE id = 1) AS mark`,
  );
  return Response.json({ mark: rows[0].mark }, { headers: { "Cache-Control": "no-store" } });
}
