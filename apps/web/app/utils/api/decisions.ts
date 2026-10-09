import { apiFetch } from "./client";

/** Smart suggestions (Jev): which key is in use and whether it is on. */
export type DecisionsView = {
  enabled: boolean;
  available: boolean;
  provider?: "typesafe" | "openrouter";
  typesafe: { keySet: boolean; keyHint?: string; rejected: boolean };
  openrouterKeySet: boolean;
};

/** What the Clarify form may pre-fill. Every field is optional: a missing one
 * means suggestions are off or Jev was not confident enough. */
export type ClarifySuggestions = {
  available: boolean;
  logId?: string;
  kind?: "task" | "reminder";
  looksLikeEvent?: boolean;
  workspaceId?: string;
  projectId?: string;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  labelIds?: string[];
  duration?: number;
  dateRole?: "deadline" | "start" | "reminder";
  severalActions?: boolean;
  notReady?: boolean;
  missing?: "duration" | "place" | "date" | "scope";
  duplicates?: { id: string; name: string }[];
};

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.message === "string") message = data.message;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const getDecisions = () => request<DecisionsView>("/agent/decisions");
export const setDecisionsEnabled = (enabled: boolean) =>
  request<DecisionsView>("/agent/decisions", "PATCH", { enabled });
/** Checks the key with one tiny call to TypeSafe, then saves it. */
export const setTypeSafeKey = (key: string) =>
  request<DecisionsView>("/agent/decisions/key", "POST", { key });
export const removeTypeSafeKey = () =>
  request<DecisionsView>("/agent/decisions/key", "DELETE");
export const sendDecisionFeedback = (logId: string, accepted: boolean) =>
  request<void>("/agent/decisions/feedback", "POST", { logId, accepted });
export const getClarifySuggestions = (inboxId: string) =>
  request<ClarifySuggestions>(
    `/inbox/${encodeURIComponent(inboxId)}/suggestions`,
  );
