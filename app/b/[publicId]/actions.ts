"use server";

import { redirect } from "next/navigation";
import { BookingError, cancelBooking } from "@/lib/server/ops.mjs";
import { paypal } from "@/lib/server/paypal";
import { allow } from "@/lib/server/rateLimit";

export async function cancel(form: FormData) {
  const publicId = String(form.get("booking") ?? "");
  if (!(await allow(`cancel:${publicId}`, 5, 60 * 60_000))) redirect(`/b/${publicId}?problem=BUSY`);
  try {
    await cancelBooking({ paypal: paypal(), publicId });
  } catch (err) {
    if (!(err instanceof BookingError)) console.error(JSON.stringify({ msg: "cancel failed", error: String(err) }));
    redirect(`/b/${publicId}?problem=${err instanceof BookingError ? err.code : "PAYPAL_UNAVAILABLE"}`);
  }
  redirect(`/b/${publicId}?done=cancelled`);
}
