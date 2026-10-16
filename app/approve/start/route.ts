import { NextResponse } from "next/server";
import { BookingError, startApproval } from "@/lib/server/ops.mjs";
import { paypal } from "@/lib/server/paypal";

const COOKIE = "hs_approve";

// Form POST from a booking page: create the PayPal vault approval and send the client there.
export async function POST(req: Request) {
  const appUrl = process.env.APP_URL!;
  const publicId = String((await req.formData()).get("booking") ?? "");
  try {
    const { approveUrl, nonce } = await startApproval({ paypal: paypal(), publicId, appUrl });
    const res = NextResponse.redirect(approveUrl, 303);
    res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/approve", maxAge: 60 * 60 });
    return res;
  } catch (err) {
    if (!(err instanceof BookingError)) console.error(JSON.stringify({ msg: "approve start failed", error: String(err) }));
    return NextResponse.redirect(`${appUrl}/b/${encodeURIComponent(publicId)}?problem=${err instanceof BookingError ? err.code : "PAYPAL_UNAVAILABLE"}`, 303);
  }
}
