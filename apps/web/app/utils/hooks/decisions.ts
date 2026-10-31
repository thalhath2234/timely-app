import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/app/_store/toastStore";
import {
  getEstimate,
  getCellFit,
  type CellFitInput,
  getCleanupSuggestions,
  getDocHints,
  getDocChecklist,
  dismissDocHint,
  restoreDocHint,
  type DocChecklist,
  type DocHintKind,
  type DocHints,
  getClarifySuggestions,
  getProjectInsights,
  getStaleWork,
  getTaskHints,
  keepStaleTask,
  mergeTaxonomy,
  type CleanupMerge,
  getDecisions,
  removeTypeSafeKey,
  sendDecisionFeedback,
  setDecisionsEnabled,
  setDecisionPrefs,
  getHighlights,
  getScreenTip,
  dismissScreenTip,
  getChatPrompts,
  getLearned,
  resetLearned,
  getStarterLabels,
  getPersonalPrefs,
  savePersonalUseCase,
  type TipScreen,
  getTodaySuggestions,
  runNotificationTriage,
  type DeepWorkTime,
  type TriageStep,
  setTypeSafeKey,
  testDecisions,
  type DecisionsView,
} from "@/app/utils/api/decisions";

export const decisionsKey = ["agent-decisions"] as const;

export function useDecisions() {
  return useQuery({ queryKey: decisionsKey, queryFn: getDecisions });
}

/** Whether smart suggestions can run (a key is set and they are on). Hooks
 * below ask nothing until this is true, so the app looks as it did before. */
const useSmartOn = () => useDecisions().data?.available === true;

/** Hides an answer cached before suggestions went off, since a disabled query
 * is not refetched. */
function whenOn<R extends { data: unknown }>(on: boolean, result: R): R {
  return on ? result : ({ ...result, data: undefined } as R);
}

function useDecisionsMutation<TVars>(
  fn: (vars: TVars) => Promise<DecisionsView>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => queryClient.setQueryData(decisionsKey, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: decisionsKey, exact: true });
      for (const key of ["clarify-suggestions", "task-hints", "stale-work", "project-insights", "cleanup-suggestions", "doc-hints", "today-suggestions", "goal-progress"])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useSetDecisionsEnabled = () =>
  useDecisionsMutation((enabled: boolean) => setDecisionsEnabled(enabled));
export const useSetDecisionPrefs = () =>
  useDecisionsMutation((prefs: { deepWorkTime?: DeepWorkTime }) => setDecisionPrefs(prefs));
export const useSetTypeSafeKey = () =>
  useDecisionsMutation((key: string) => setTypeSafeKey(key));
export const useRemoveTypeSafeKey = () =>
  useDecisionsMutation<void>(() => removeTypeSafeKey());

/** Suggestions for one Inbox item. Off or unsure returns an empty answer, so
 * the form simply looks like it does today. Pass enabled=false while
 * suggestions are unavailable, so nothing is asked and no spinner shows. */
export function useClarifySuggestions(inboxId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["clarify-suggestions", inboxId],
    queryFn: () => getClarifySuggestions(inboxId!),
    enabled: Boolean(inboxId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useTestDecisions() {
  return useMutation({ mutationFn: testDecisions });
}

export function useDecisionFeedback() {
  return useMutation({
    mutationFn: (vars: { logId: string; accepted: boolean }) =>
      sendDecisionFeedback(vars.logId, vars.accepted),
  });
}

/** Hints from a task's own words; empty while suggestions are off. */
export function useTaskHints(taskId: string | undefined, enabled = true, version = "") {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["task-hints", taskId, version],
    queryFn: () => getTaskHints(taskId!),
    enabled: on && Boolean(taskId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  }));
}

/** Open Work with no activity for three weeks, with what each likely needs. */
export function useStaleWork(enabled = true) {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["stale-work"],
    queryFn: getStaleWork,
    enabled: on && enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  }));
}

export function useKeepStaleTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: keepStaleTask,
    onSuccess: (_data, taskId) =>
      queryClient.setQueryData(["stale-work"], (old: { tasks: { id: string }[] } | undefined) =>
        old ? { ...old, tasks: old.tasks.filter((t) => t.id !== taskId) } : old,
      ),
  });
}

export function useProjectInsights(projectId: string | undefined, version = "") {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["project-insights", projectId, version],
    queryFn: () => getProjectInsights(projectId!),
    enabled: on && Boolean(projectId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  }));
}

export function useCleanupSuggestions(workspaceId: string | undefined) {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["cleanup-suggestions", workspaceId],
    queryFn: () => getCleanupSuggestions(workspaceId!),
    enabled: on && Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  }));
}

/** Merges, then refreshes everything that shows labels, statuses or fields. */
export function useMergeTaxonomy(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (merge: CleanupMerge) => mergeTaxonomy(workspaceId, merge),
    onSuccess: () => {
      for (const key of ["workspaces", "tasks", "today", "projects", "config", "cleanup-suggestions"])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

/** Suggestions for a doc; `version` refetches after the text settles. */
export function useDocHints(docId: string | undefined, version = "", enabled = true) {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["doc-hints", docId, version],
    queryFn: () => getDocHints(docId!),
    enabled: on && Boolean(docId) && enabled,
    // Keeps the card up while a newer read loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    retry: false,
  }));
}

type DocHintChange = { kind: DocHintKind; value?: string; restore?: boolean };

const docHintChangeKey = (docId: string) => ["doc-hint-change", docId] as const;

/** Dismisses a doc suggestion for good, or with `restore` takes a dismissal
 * back. The doc's cached suggestions and checklist offers are read again
 * afterwards, so the row stays gone when the doc reopens. The doc's task
 * offers switch ("todos") flips at once everywhere it shows
 * (useDocOffersOff), and flips back with a message if it could not be saved. */
export function useDismissDocHint(docId: string) {
  const client = useQueryClient();
  const reads = [["doc-hints", docId], ["doc-checklist", docId]];
  // A read under way may have started before the change was saved.
  const cancelReads = () => Promise.all(reads.map((queryKey) => client.cancelQueries({ queryKey })));
  return useMutation({
    mutationKey: docHintChangeKey(docId),
    // One at a time per doc, so the last change made is the one kept.
    scope: { id: `doc-hint-change:${docId}` },
    mutationFn: ({ kind, value, restore }: DocHintChange) => (restore ? restoreDocHint : dismissDocHint)(docId, kind, value),
    onMutate: async ({ kind, restore }) => {
      if (kind !== "todos") return;
      await cancelReads();
      const before = reads.flatMap((queryKey) => client.getQueriesData({ queryKey }));
      client.setQueriesData<DocHints>({ queryKey: ["doc-hints", docId] }, (old) => old && { ...old, todosOff: !restore });
      client.setQueriesData<DocChecklist>({ queryKey: ["doc-checklist", docId] }, (old) => old && { ...old, off: !restore });
      return before;
    },
    onError: (error, { kind }, before) => {
      for (const [queryKey, data] of before ?? []) client.setQueryData(queryKey, data);
      if (kind === "todos") useToastStore.getState().show("Couldn’t change task offers for this doc. Try again.");
      // The doc keeps too many dismissals: this one will show again.
      else if ((error as { status?: number }).status === 409) useToastStore.getState().show(error.message);
    },
    onSettled: async (_data, error, { kind }) => {
      if (kind === "todos") await cancelReads();
      const reread = Promise.all(reads.map((queryKey) => client.invalidateQueries({ queryKey })));
      // Saved: the change shows as pending until the new read is in. Not
      // saved: the old answer is back already, and offline the read waits.
      if (!error) await reread;
    },
  });
}

/** Whether the doc's task offers are off: a change still being saved wins
 * over `saved`, the cached answer, which may have been read before it. */
export function useDocOffersOff(docId: string, saved: boolean | undefined) {
  const pending = useMutationState({
    filters: {
      mutationKey: docHintChangeKey(docId),
      status: "pending",
      predicate: (mutation) => (mutation.state.variables as DocHintChange | undefined)?.kind === "todos",
    },
    select: (mutation) => !(mutation.state.variables as DocHintChange).restore,
  });
  return pending.length > 0 ? pending[pending.length - 1] : Boolean(saved);
}

/** Which unchecked checklist items of a doc are already tasks, which to offer
 * as tasks and where new ones go. Offers need smart suggestions on: Jev reads
 * which items are things to get done. */
export function useDocChecklist(docId: string | undefined, names: string[], projectId?: string) {
  // Asked again when suggestions go on or off, so offers come and go with them;
  // not before they are known, or the first read is made twice.
  const status = useDecisions();
  const on = status.data?.available === true;
  return useQuery({
    queryKey: ["doc-checklist", docId, names, projectId ?? "", on],
    // names says which items an answer covers while a newer one loads.
    queryFn: async () => ({ ...(await getDocChecklist(docId!, names, projectId)), names }),
    enabled: Boolean(docId) && names.length > 0 && status.isFetched,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    retry: false,
  });
}

/** Today's focus picks and free-gap suggestion; empty while suggestions are off.
 * version changes when Today's focus or plan changes, so picks refresh. */
export function useTodaySuggestions(timezone: string, version = "", enabled = true) {
  const on = useSmartOn();
  return whenOn(on, useQuery({
    queryKey: ["today-suggestions", timezone, version],
    queryFn: () => getTodaySuggestions(timezone),
    enabled: on && enabled,
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  }));
}

/** Dashboard Highlights for the facts the card worked out; asked again when
 * the facts change, at most every ten minutes otherwise. */
export function useHighlights(facts: { id: string; text: string }[], enabled = true) {
  const key = facts.map((fact) => fact.text).join("\n");
  return useQuery({
    queryKey: ["highlights", key],
    queryFn: () => getHighlights(facts),
    enabled,
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Runs a notification's suggested next step, then refreshes what it touched. */
export function useNotificationTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; action: TriageStep }) => runNotificationTriage(vars.id, vars.action),
    onSettled: () => {
      for (const key of ["notifications", "tasks", "today", "calendar", "today-suggestions"])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The one tip smart suggestions pick for a screen, if any. */
export function useScreenTip(screen: TipScreen) {
  return useQuery({
    queryKey: ["screen-tip", screen],
    queryFn: () => getScreenTip(screen, browserZone()),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useDismissTip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; logId?: string }) => dismissScreenTip(vars.key, vars.logId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["screen-tip"] }),
  });
}

/** Example prompts for the empty chat, fitted to a project. */
export function useChatPrompts(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["chat-prompts", projectId ?? ""],
    queryFn: () => getChatPrompts(projectId, browserZone()),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useLearned(enabled = true) {
  return useQuery({ queryKey: ["decisions-learned"], queryFn: getLearned, enabled });
}

export function useResetLearned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (feature: string) => resetLearned(feature),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["decisions-learned"] }),
  });
}

/** Starter labels smart suggestions think a workspace is missing. */
export function useStarterLabels(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["starter-labels", workspaceId ?? ""],
    queryFn: () => getStarterLabels(workspaceId!),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** What the person told Timely they use it for. */
export function usePersonalPrefs(enabled = true) {
  return useQuery({ queryKey: ["personal-prefs"], queryFn: getPersonalPrefs, enabled });
}

export function useSaveUseCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (useCase: string) => savePersonalUseCase(useCase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-prefs"] });
      queryClient.invalidateQueries({ queryKey: ["starter-labels"] });
    },
  });
}

/** A suggested length for new Work with this title, asked a moment after the
 * title stops changing; undefined while suggestions are off or unsure. */
export function useSuggestedDuration(title: string, enabled: boolean) {
  const on = useSmartOn() && enabled;
  const [answer, setAnswer] = useState<{ title: string; minutes: number }>();
  useEffect(() => {
    const name = title.trim();
    if (!on || name.length < 3) return;
    let stale = false;
    const timer = setTimeout(() => {
      getEstimate(name)
        .then((next) => {
          if (!stale && next.available && next.minutes) setAnswer({ title: name, minutes: next.minutes });
        })
        .catch(() => {});
    }, 800);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [title, on]);
  return on && answer?.title === title.trim() ? answer.minutes : undefined;
}

/** One edited cell to check, with an id that is new for every edit. */
export type CellFitEdit = { id: number; rowId: string; columnId: string; input: CellFitInput };

/** A hint that the latest checked entry may not fit its column, asked once
 * per edit a moment after it is saved. The last hint stays until a newer one
 * replaces it; nothing is asked while suggestions are off. */
export function useCellFit(edit: CellFitEdit | null) {
  const on = useSmartOn();
  const [answer, setAnswer] = useState<{ id: number; rowId: string; columnId: string; value: string; hint: string; logId?: string }>();
  useEffect(() => {
    if (!on || !edit) return;
    let stale = false;
    const timer = setTimeout(() => {
      getCellFit(edit.input)
        .then((next) => {
          if (!stale && next.available && next.misfit && next.hint)
            setAnswer({ id: edit.id, rowId: edit.rowId, columnId: edit.columnId, value: edit.input.value, hint: next.hint, logId: next.logId });
        })
        .catch(() => {});
    }, 700);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [edit, on]);
  return on ? answer : undefined;
}
