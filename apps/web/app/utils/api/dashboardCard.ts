import { apiFetch } from "./client";
import { codedError } from "./codedError";

export type DescribedAnswer = { program: string; provider: string; model: string };

/**
 * Builds a described dashboard card from the person's words with the
 * account's AI provider, or changes `current` (the card's program) by them.
 */
export async function describeCardWithAi(
  body: { prompt: string; today: string; current?: string; place?: "dashboard" | "doc" },
  signal?: AbortSignal,
): Promise<DescribedAnswer> {
  const res = await apiFetch("/agent/dashboard-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await codedError(res, "Could not build the card. Try again.");
  return res.json();
}
