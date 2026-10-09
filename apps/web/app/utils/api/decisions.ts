import { apiFetch } from "./client";

/** Smart suggestions (Jev): which key is in use and whether it is on. */
export type DecisionsView = {
  enabled: boolean;
  available: boolean;
  provider?: "typesafe" | "openrouter";
  typesafe: { keySet: boolean; keyHint?: string; rejected: boolean };
  openrouterKeySet: boolean;
};

/** One live call with the keys suggestions use, in the same order. */
export type DecisionsTest = {
  ok: boolean;
  provider?: "typesafe" | "openrouter";
  latencyMs: number;
  error?: string;
};

/** What the Clarify form may pre-fill. Every field is optional: a missing one
 * means suggestions are off or Jev was not confident enough. */
export type ClarifySuggestions = {
  available: boolean;
  logId?: string;
  /** Set when suggestions are on but the call failed. */
  error?: string;
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
export const testDecisions = () =>
  request<DecisionsTest>("/agent/decisions/test", "POST");
export const sendDecisionFeedback = (logId: string, accepted: boolean) =>
  request<void>("/agent/decisions/feedback", "POST", { logId, accepted });
/** The saved template a new sheet's title calls for, if any. */
export type SheetTemplateSuggestion = {
  available: boolean;
  logId?: string;
  templateId?: string;
};
/** One suggested type per imported column; null keeps the column as text. */
export type ColumnTypeSuggestions = {
  available: boolean;
  logId?: string;
  columns: ({ type: string; options?: string[] } | null)[];
};
export const getSheetTemplateSuggestion = (title: string) =>
  request<SheetTemplateSuggestion>(
    `/suggestions/sheet-template?title=${encodeURIComponent(title)}`,
  );
export const getColumnTypeSuggestions = (
  columns: { name: string; values: string[] }[],
) =>
  request<ColumnTypeSuggestions>("/suggestions/column-types", "POST", {
    columns,
  });
export const getClarifySuggestions = (inboxId: string) =>
  request<ClarifySuggestions>(
    `/inbox/${encodeURIComponent(inboxId)}/suggestions`,
  );

/** What a task's own words suggest (Phase 5). Every field is optional. */
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
export const getTaskHints = (taskId: string) =>
  request<TaskHints>(`/suggestions/task/${encodeURIComponent(taskId)}`);

export type StaleVerdict = "actionable" | "clarify" | "blocked" | "obsolete";
export type StaleWork = {
  available: boolean;
  logId?: string;
  tasks: { id: string; name: string; idleDays: number; verdict?: StaleVerdict }[];
};
export const getStaleWork = () => request<StaleWork>("/suggestions/stale-work");
/** Records a review that keeps the task, which restarts its idle days. */
export const keepStaleTask = (taskId: string) =>
  request<void>(`/suggestions/stale-work/${encodeURIComponent(taskId)}/keep`, "POST");

export type ProjectInsights = {
  available: boolean;
  logId?: string;
  facts: {
    open: number;
    done: number;
    doneRecent: number;
    overdue: number;
    blocked: number;
    idleDays: number;
    daysLeft?: number;
  };
  health?: "progressing" | "stalled" | "blocked";
  noBrief?: boolean;
  noOutcome?: boolean;
  noNextAction?: boolean;
  uncovered?: string[];
  misfiled?: { taskId: string; name: string; moveTo?: string; moveToTitle?: string; stageId?: string }[];
  overlaps?: { id: string; title: string }[];
};
export const getProjectInsights = (projectId: string) =>
  request<ProjectInsights>(`/suggestions/project/${encodeURIComponent(projectId)}`);

export type ProjectStart = {
  available: boolean;
  logId?: string;
  copyProjectId?: string;
  copyTitle?: string;
  docTemplateId?: string;
  docTitle?: string;
  sheetTemplateId?: string;
  sheetTitle?: string;
};
export const getProjectStart = (title: string, workspaceId: string) =>
  request<ProjectStart>(
    `/suggestions/project-template?title=${encodeURIComponent(title)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );

export type CleanupItem = { id: string; name: string; uses: number };
export type CleanupMerge = {
  kind: "label" | "status" | "option";
  fieldId?: string;
  fieldName?: string;
  from: CleanupItem;
  into: CleanupItem;
};
export const getCleanupSuggestions = (workspaceId: string) =>
  request<{ available: boolean; logId?: string; merges: CleanupMerge[] }>(
    `/suggestions/workspace/${encodeURIComponent(workspaceId)}/cleanup`,
  );

export type MergeResult = { tasks: number; projects: number; views: number };
/** Folds one label, status or select option into another everywhere it is used. */
export const mergeTaxonomy = (workspaceId: string, merge: CleanupMerge) => {
  const ws = encodeURIComponent(workspaceId);
  if (merge.kind === "option")
    return request<MergeResult>(
      `/workspaces/${ws}/custom-field/${encodeURIComponent(merge.fieldId ?? "")}/options/merge`,
      "POST",
      { from: merge.from.id, into: merge.into.id },
    );
  const path = merge.kind === "label" ? "lable" : "status";
  return request<MergeResult>(`/workspaces/${ws}/${path}/${encodeURIComponent(merge.from.id)}/merge`, "POST", {
    into: merge.into.id,
  });
};
