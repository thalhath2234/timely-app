import { api } from "./client";

export type DescribedAnswer = { program: string; provider: string; model: string };

/**
 * Builds a described dashboard card from the person's words with the
 * account's AI provider, or changes `current` (the card's program) by them.
 * `place: "doc"` builds a live block, which takes the doc's width.
 */
export function describeCardWithAi(body: { prompt: string; today: string; current?: string; place?: "dashboard" | "doc" }) {
  return api<DescribedAnswer>("/agent/dashboard-card", { method: "POST", body });
}
