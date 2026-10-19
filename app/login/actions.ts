"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { OWNER_COOKIE, ownerCookieValue, passcodeMatches } from "@/lib/server/owner";
import { allow, clientKey } from "@/lib/server/rateLimit";

export async function signIn(_prev: string | null, form: FormData): Promise<string | null> {
  // Per visitor, so one person guessing can't lock judges out; plus an overall cap on guessing.
  const ip = clientKey(await headers());
  if (!(await allow(`login:${ip}`, 10, 15 * 60_000)) || !(await allow("login:all", 200, 15 * 60_000))) return "Too many attempts. Try again in 15 minutes.";
  if (!passcodeMatches(String(form.get("passcode") ?? ""))) return "That passcode is not right.";
  (await cookies()).set(OWNER_COOKIE, ownerCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  redirect("/desk");
}
