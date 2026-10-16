"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { advanceClock, checkIn, markNoShow, BookingError } from "@/lib/server/ops.mjs";
import { pool } from "@/lib/server/db.mjs";
import { resetDemo } from "@/lib/server/seed.mjs";
import { isOwner } from "@/lib/server/owner";
import { paypal } from "@/lib/server/paypal";

async function owner() {
  if (!(await isOwner())) redirect("/login");
}

export type ActionResult = { error?: string };

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  await owner();
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof BookingError)) console.error(JSON.stringify({ msg: "front desk action failed", error: String(err) }));
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
  revalidatePath("/");
  return {};
}

export async function advance(hours: number) {
  return run(() => advanceClock({ paypal: paypal(), hours }));
}

export async function checkInBooking(bookingId: string) {
  return run(() => checkIn({ paypal: paypal(), bookingId }));
}

export async function noShowBooking(bookingId: string) {
  return run(() => markNoShow({ paypal: paypal(), bookingId }));
}

export async function reset() {
  return run(() => resetDemo(pool()));
}

export async function signOut() {
  const { cookies } = await import("next/headers");
  (await cookies()).delete("hs_owner");
  redirect("/login");
}
