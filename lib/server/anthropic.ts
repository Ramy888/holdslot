import Anthropic from "@anthropic-ai/sdk";

const g = globalThis as typeof globalThis & { __holdslotAnthropic?: Anthropic };

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  g.__holdslotAnthropic ??= new Anthropic();
  return g.__holdslotAnthropic;
}
