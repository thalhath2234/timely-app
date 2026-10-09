import { api } from "./client";

export type DecisionProvider = "typesafe" | "openrouter";

/** Smart suggestions settings. TypeSafe's key is used first, the OpenRouter
 * key second; `available` is false when neither works or it is switched off. */
export type DecisionSettings = {
  enabled: boolean;
  available: boolean;
  provider?: DecisionProvider;
  typesafe: { keySet: boolean; keyHint?: string; rejected: boolean };
  openrouterKeySet: boolean;
};

export type DecisionsStatus = { available: boolean; provider: string };

/** Suggestions for one Inbox item. Every field is optional: a missing field
 * means the model had no confident answer for it. */
export type InboxSuggestions = {
  available: boolean;
  logId?: string;
  kind?: "task" | "reminder";
  looksLikeEvent?: boolean;
  workspaceId?: string;
  projectId?: string;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  labelIds?: string[];
  /** Minutes. */
  duration?: number;
  dateRole?: "deadline" | "start" | "reminder";
  severalActions?: boolean;
  notReady?: boolean;
  missing?: "duration" | "place" | "date" | "scope";
  duplicates?: { id: string; name: string }[];
};

// Like provider settings, these never enter the offline mutation queue: a
// queued key could not report whether TypeSafe accepted it.
export const getDecisionSettings = () => api<DecisionSettings>("/agent/decisions");
export const patchDecisionSettings = (enabled: boolean) =>
  api<DecisionSettings>("/agent/decisions", { method: "PATCH", body: { enabled } });
/** Checks the key with one tiny TypeSafe call, then saves it. A refused key
 * fails with 409 and the server's message. */
export const setTypeSafeKey = (key: string) =>
  api<DecisionSettings>("/agent/decisions/key", { method: "POST", body: { key } });
export const removeTypeSafeKey = () =>
  api<DecisionSettings>("/agent/decisions/key", { method: "DELETE" });
export const sendDecisionFeedback = (logId: string, accepted: boolean) =>
  api<void>("/agent/decisions/feedback", { method: "POST", body: { logId, accepted } });

export const getDecisionsStatus = () => api<DecisionsStatus>("/decisions/status");
/** Can take a few seconds: it asks the model. */
export const getInboxSuggestions = (id: string) =>
  api<InboxSuggestions>(`/inbox/${encodeURIComponent(id)}/suggestions`);
