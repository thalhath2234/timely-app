import type { ImportFormat } from "@timely/contract/importFormat";
import { deviceTimezone } from "../format";
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
  deepWorkTime?: "" | "morning" | "afternoon" | "evening";
};

export type EffortKind = "deep" | "admin" | "creative" | "routine";

export type DecisionsStatus = { available: boolean; provider: string };

/** Suggestions for one Inbox item. Every field is optional: a missing field
 * means the model had no confident answer for it. */
export type InboxSuggestions = {
  available: boolean;
  logId?: string;
  /** Set when suggestions are on but could not run (a refused key, a timeout). */
  error?: string;
  kind?: "task" | "reminder";
  looksLikeEvent?: boolean;
  workspaceId?: string;
  projectId?: string;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  labelIds?: string[];
  /** Minutes. */
  duration?: number;
  dateRole?: "deadline" | "start" | "reminder";
  /** The date (YYYY-MM-DD) and time (HH:MM) code read from the words. */
  date?: string;
  time?: string;
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
export type DeepWorkTime = NonNullable<DecisionSettings["deepWorkTime"]>;
export const patchDeepWorkTime = (deepWorkTime: DeepWorkTime) =>
  api<DecisionSettings>("/agent/decisions", { method: "PATCH", body: { deepWorkTime } });
/** One live call with the keys suggestions use, in the same order. */
export type DecisionsTest = { ok: boolean; provider?: DecisionProvider; latencyMs: number; error?: string };
export const testDecisions = () => api<DecisionsTest>("/agent/decisions/test", { method: "POST" });
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
  api<InboxSuggestions>(`/inbox/${encodeURIComponent(id)}/suggestions?timezone=${encodeURIComponent(deviceTimezone())}`);

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
/** The doc template a new doc's title calls for: one of the person's own
 * template docs (its id) or a built-in ("builtin:meeting" and so on). */
export type DocTemplateSuggestion = { available: boolean; logId?: string; templateId?: string; title?: string };
export const getDocTemplateSuggestion = (title: string) =>
  api<DocTemplateSuggestion>(`/suggestions/doc-template?title=${encodeURIComponent(title)}`);
export const getColumnTypeSuggestions = (columns: { name: string; values: string[] }[]) =>
  api<ColumnTypeSuggestions>("/suggestions/column-types", { method: "POST", body: { columns } });
/** Whether a new entry in a text or select column fits that column. */
export type CellFit = { available: boolean; logId?: string; misfit: boolean; hint?: string };
export type CellFitInput = { column: string; type: string; value: string; values: string[]; options?: string[] };
export const getCellFit = (input: CellFitInput) =>
  api<CellFit>("/suggestions/cell-fit", { method: "POST", body: input });
/** What each line of a plain-text import is, "paragraph" when unsure. */
export const getImportFormat = (lines: string[]) =>
  api<ImportFormat>("/suggestions/import-format", { method: "POST", body: { lines } });

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
  effortKind?: EffortKind;
  /** A long task that reads like it needs one unbroken stretch. */
  oneSitting?: boolean;
  /** Deep-focus work with no preferred window, for the person's best time of day. */
  preferredTime?: Exclude<DeepWorkTime, "">;
  preferredWindow?: { start: string; end: string };
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

/** What a new project's title suggests starting from: an earlier project to
 * copy, a doc template and a sheet template. */
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
  api<ProjectStart>(
    `/suggestions/project-template?title=${encodeURIComponent(title)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );

/** Labels, statuses or select options that look like the same thing. */
export type CleanupItem = { id: string; name: string; uses: number };
export type CleanupMerge = {
  kind: "label" | "status" | "option";
  fieldId?: string;
  fieldName?: string;
  from: CleanupItem;
  into: CleanupItem;
};
export const getCleanupSuggestions = (workspaceId: string) =>
  api<{ available: boolean; logId?: string; merges: CleanupMerge[] }>(
    `/suggestions/workspace/${encodeURIComponent(workspaceId)}/cleanup`,
  );
export type MergeResult = { tasks: number; projects: number; views: number };
/** Folds one label, status or select option into another everywhere it is used. */
export const mergeTaxonomy = (workspaceId: string, merge: CleanupMerge) => {
  const ws = encodeURIComponent(workspaceId);
  if (merge.kind === "option")
    return api<MergeResult>(`/workspaces/${ws}/custom-field/${encodeURIComponent(merge.fieldId ?? "")}/options/merge`, {
      method: "POST",
      body: { from: merge.from.id, into: merge.into.id },
    });
  const path = merge.kind === "label" ? "lable" : "status";
  return api<MergeResult>(`/workspaces/${ws}/${path}/${encodeURIComponent(merge.from.id)}/merge`, {
    method: "POST",
    body: { into: merge.into.id },
  });
};

/** Suggestions for one doc. The phone shows where it belongs, its type and
 * property values, lines that read like tasks and whether it looks out of date. */
export type DocHints = {
  available: boolean;
  logId?: string;
  project?: { id: string; title: string };
  parent?: { id: string; title: string };
  work?: string[];
  docType?: string;
  properties?: { key: string; value: string }[];
  template?: { id: string; title: string };
  outdated?: boolean;
};
export const getDocHints = (id: string) => api<DocHints>(`/suggestions/doc/${encodeURIComponent(id)}`);

export type MentionTarget = { kind: "task" | "project" | "doc" | "sheet"; id: string; title: string };
/** What a selected phrase may refer to: Jev's match when sure, and up to six
 * close items to pick from. Empty while suggestions are off. */
export type MentionMatch = { available: boolean; logId?: string; match?: MentionTarget; options: MentionTarget[] };
export const matchMention = (text: string, docId?: string) =>
  api<MentionMatch>("/suggestions/mention", { method: "POST", body: { text, docId } });

/** Today: open Work worth focusing on, the best Work for the next free gap,
 * and how the top open Work lines up with the person's goals. */
export type TodaySuggestions = {
  available: boolean;
  logId?: string;
  error?: string;
  focus?: { taskId: string; name: string; reasons: string[]; goal?: string; effortKind?: EffortKind }[];
  gap?: {
    start: string;
    end: string;
    minutes: number;
    task?: { id: string; name: string; minutes: number; effortKind?: EffortKind };
  };
  goals?: { goal: string; count: number }[];
};
/** Can take a few seconds: it asks the model. */
export const getTodaySuggestions = (timezone: string) =>
  api<TodaySuggestions>(`/suggestions/today?timezone=${encodeURIComponent(timezone)}`);

/** Dashboard Highlights: facts worth a look, why Work is blocked or left
 * unfinished, and tips the person's own data backs. */
export type HighlightGroup = { key: string; label: string; count: number; tasks: { id: string; name: string }[] };
export type Highlights = {
  available: boolean;
  logId?: string;
  highlights: { id: string; text: string }[];
  blockers: HighlightGroup[];
  missed: HighlightGroup[];
  tips: { key: string; text: string }[];
};
export const getHighlights = (facts: { id: string; text: string }[]) =>
  api<Highlights>("/suggestions/highlights", { method: "POST", body: { facts } });

export type AlertStep = "review" | "clarify" | "focus" | "reschedule";
export type TriageStep = "reschedule" | "extend" | "addtime" | "move" | "lower" | AlertStep;
/** Runs a missed or overdue notification's next step and marks it read. */
export const runNotificationTriage = (id: string, action: TriageStep) =>
  api<{ message: string }>(`/notifications/${encodeURIComponent(id)}/triage`, { method: "POST", body: { action } });

/** Onboarding and personalisation: what the person uses Timely for, starter
 * labels, the one tip for a screen, and example prompts for the chat. */
export type StarterUse = { key: string; label: string; workspace?: string };
export type StarterLabel = { name: string; color: string };
export type PersonalPrefs = { useCase: string; dismissedTips: string[] };
export const getPersonalPrefs = () => api<{ prefs: PersonalPrefs; uses: StarterUse[] }>("/suggestions/prefs");
export const savePersonalUseCase = (useCase: string) =>
  api<{ prefs: PersonalPrefs }>("/suggestions/prefs", { method: "PATCH", body: { useCase } });
/** The catalog's labels for the picked uses; code only, so it works before any key is saved. */
export const getStarterPresets = (uses: string[]) =>
  api<{ labels: StarterLabel[]; uses: StarterUse[] }>(`/suggestions/starter/presets?uses=${encodeURIComponent(uses.join(","))}`);
export const getStarterLabels = (workspaceId: string) =>
  api<{ available: boolean; logId?: string; labels: StarterLabel[] }>(`/suggestions/starter?workspaceId=${encodeURIComponent(workspaceId)}`);
export const applyStarterLabels = (workspaceId: string, labels: StarterLabel[]) =>
  api<{ created: { id: string; name: string; color: string }[]; skipped: string[] }>("/suggestions/starter/apply", {
    method: "POST",
    body: { workspaceId, labels },
  });

export type TipScreen = "today" | "tasks" | "calendar" | "inbox";
export type TipAction = "inbox" | "calendar" | "settings_schedule" | "settings_workspaces";
export type ScreenTip = { key: string; text: string; action?: TipAction };
export const getScreenTip = (screen: TipScreen, timezone: string) =>
  api<{ available: boolean; logId?: string; tip: ScreenTip | null }>(
    `/suggestions/tip?screen=${screen}&platform=mobile&timezone=${encodeURIComponent(timezone)}`,
  );
export const dismissScreenTip = (key: string, logId?: string) =>
  api<void>("/suggestions/tips/dismiss", { method: "POST", body: { key, logId } });

export type ChatPrompt = { key: string; title: string; text: string };
export const getChatPrompts = (projectId: string | undefined, timezone: string) =>
  api<{ available: boolean; logId?: string; project?: string; prompts: ChatPrompt[] }>("/suggestions/prompts", {
    method: "POST",
    body: { projectId: projectId ?? "", timezone },
  });

export type LearnedFeature = { feature: string; kept: number; decided: number; raise: number };
export const getLearned = () => api<{ features: LearnedFeature[] }>("/agent/decisions/learned");
export const resetLearned = (feature: string) => api<void>("/agent/decisions/learned/reset", { method: "POST", body: { feature } });

/** The work length smart suggestions would offer for a new title; offered, never set. */
export const getEstimate = (name: string, description = "") =>
  api<{ available: boolean; minutes?: number }>("/suggestions/estimate", { method: "POST", body: { name, description } });
