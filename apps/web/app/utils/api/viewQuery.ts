import type { AiViewDraft } from "@timely/contract/viewLanguage";
import { apiFetch } from "./client";

export type ViewQueryResult = { view: AiViewDraft; dropped?: string[]; provider: string; model: string };

/** Reads a view request with the account's AI provider [natural-language views]. */
export async function readViewWithAi(
  body: { query: string; today: string; client: "web" | "phone" },
  signal?: AbortSignal,
): Promise<ViewQueryResult> {
  const res = await apiFetch("/agent/view-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = "Could not read that. Try again.";
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
