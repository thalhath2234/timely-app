import type { AiViewDraft } from "@timely/contract/viewLanguage";
import { api } from "./client";

export type ViewQueryResult = { view: AiViewDraft; dropped?: string[]; provider: string; model: string };

/** Reads a view request with the account's AI provider [natural-language views]. */
export function readViewWithAi(body: { query: string; today: string; client: "web" | "phone" }) {
  return api<ViewQueryResult>("/agent/view-query", { method: "POST", body });
}
