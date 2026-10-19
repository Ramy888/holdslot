"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { compilePolicy, normalizeRules } from "@/lib/policy.mjs";
import { saveSettings } from "@/lib/server/db.mjs";
import { anthropic } from "@/lib/server/anthropic";
import { isOwner } from "@/lib/server/owner";
import { allow } from "@/lib/server/rateLimit";

export type Rules = ReturnType<typeof normalizeRules>;
export type ReadResult = { rules?: Rules; text?: string; error?: string };

/** Claude reads the owner's policy into rules. Nothing is saved until the owner confirms. */
export async function readPolicy(_prev: ReadResult, form: FormData): Promise<ReadResult> {
  if (!(await isOwner())) redirect("/login");
  const text = String(form.get("policy") ?? "");
  if (!(await allow("policy", 15, 60 * 60_000))) return { text, error: "Too many reads this hour. Try again later." };
  try {
    return { text, rules: await compilePolicy({ anthropic: anthropic(), text, model: process.env.ANTHROPIC_MODEL || undefined }) };
  } catch (err) {
    return { text, error: err instanceof Error ? err.message : "Could not read the policy." };
  }
}

export async function savePolicy(form: FormData) {
  if (!(await isOwner())) redirect("/login");
  const rules = normalizeRules(JSON.parse(String(form.get("rules") ?? "{}")));
  await saveSettings({ policyText: String(form.get("policy") ?? ""), rules });
  revalidatePath("/desk");
  redirect("/policy?saved=1");
}
