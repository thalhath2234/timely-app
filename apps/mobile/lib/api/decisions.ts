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

/** The saved template a new sheet's title calls for, if any. */
export type SheetTemplateSuggestion = { available: boolean; logId?: string; templateId?: string };
/** One suggested type per imported column; null keeps the column as text. */
export type ColumnTypeSuggestions = {
  available: boolean;
  logId?: string;
  columns: ({ type: string; options?: string[] } | null)[];
};
export const getSheetTemplateSuggestion = (title: string) =>
  api<SheetTemplateSuggestion>(`/suggestions/sheet-template?title=${encodeURIComponent(title)}`);
export const getColumnTypeSuggestions = (columns: { name: string; values: string[] }[]) =>
  api<ColumnTypeSuggestions>("/suggestions/column-types", { method: "POST", body: { columns } });

/** What a task's own words suggest. Every field is optional. */
export type TaskHints = {
  available: boolean;
  logId?: string;
  statusId?: string;
  stageId?: string;
  fields?: { fieldId: string; type: string; optionIds?: string[]; value?: string }[];
  blockedBy?: { id: string; name: string };
  vagueOutcome?: boolean;
  checklistGap?: boolean;
  notDone?: boolean;
  openChecklist?: number;
};
export const getTaskHints = (id: string) => api<TaskHints>(`/suggestions/task/${encodeURIComponent(id)}`);

export type StaleVerdict = "actionable" | "clarify" | "blocked" | "obsolete";
export type StaleWork = {
  available: boolean;
  logId?: string;
  tasks: { id: string; name: string; idleDays: number; verdict?: StaleVerdict }[];
};
export const getStaleWork = () => api<StaleWork>("/suggestions/stale-work");
export const keepStaleTask = (id: string) =>
  api<void>(`/suggestions/stale-work/${encodeURIComponent(id)}/keep`, { method: "POST" });

export type ProjectInsights = {
  available: boolean;
  logId?: string;
  facts: { open: number; done: number; doneRecent: number; overdue: number; blocked: number; idleDays: number; daysLeft?: number };
  health?: "progressing" | "stalled" | "blocked";
  noBrief?: boolean;
  noOutcome?: boolean;
  noNextAction?: boolean;
  uncovered?: string[];
  misfiled?: { taskId: string; name: string; moveTo?: string; moveToTitle?: string; stageId?: string }[];
  overlaps?: { id: string; title: string }[];
};
export const getProjectInsights = (id: string) =>
  api<ProjectInsights>(`/suggestions/project/${encodeURIComponent(id)}`);
