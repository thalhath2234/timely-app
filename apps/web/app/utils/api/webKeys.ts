import type { WebSearchKeys } from "@timely/contract/agentLearning";
import { apiFetch } from "./client";

/**
 * Settings → Agent → Web search (Q-3.8): a search key the agent's web
 * search uses instead of the chat provider's own search. Write-only: the
 * server answers with the key's hint, never the key.
 */
async function webKeysRequest(
  method: "GET" | "PUT" | "DELETE",
  body?: unknown,
): Promise<WebSearchKeys> {
  const res = await apiFetch("/agent/web-keys", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message || "Couldn't save the search key. Try again.");
  }
  // A change that answers nothing is read back.
  if (res.status === 204) return webKeysRequest("GET");
  return res.json();
}

export const getWebKeys = () => webKeysRequest("GET");
export const setWebKey = (backend: string, key: string) =>
  webKeysRequest("PUT", { backend, key });
export const removeWebKey = () => webKeysRequest("DELETE");
