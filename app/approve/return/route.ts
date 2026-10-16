import { NextResponse } from "next/server";
import { BookingError, completeApproval } from "@/lib/server/ops.mjs";
import { paypal } from "@/lib/server/paypal";

// PayPal sends the client here after approving. The approval is found by this
// browser's cookie, not the query string, so a copied link can't claim it.
export async function GET(req: Request) {
  const appUrl = process.env.APP_URL!;
  const nonce = req.headers.get("cookie")?.match(/hs_approve=([^;]+)/)?.[1];
  try {
    const publicId = await completeApproval({ paypal: paypal(), nonce });
    const res = NextResponse.redirect(`${appUrl}/b/${publicId}?done=approved`, 303);
    res.cookies.delete({ name: "hs_approve", path: "/approve" });
    return res;
  } catch (err) {
    if (!(err instanceof BookingError)) console.error(JSON.stringify({ msg: "approve return failed", error: String(err) }));
    return NextResponse.redirect(`${appUrl}/book?problem=${err instanceof BookingError ? err.code : "PAYPAL_UNAVAILABLE"}`, 303);
  }
}
