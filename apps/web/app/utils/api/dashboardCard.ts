import { apiFetch } from "./client";

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
  if (!res.ok) {
    let message = "Could not build the card. Try again.";
    try {
      const data = await res.json();
      if (typeof data?.message === "string") message = data.message;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return res.json();
}
