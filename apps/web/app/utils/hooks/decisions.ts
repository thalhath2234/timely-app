import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCleanupSuggestions,
  getDocHints,
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

function useDecisionsMutation<TVars>(
  fn: (vars: TVars) => Promise<DecisionsView>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => queryClient.setQueryData(decisionsKey, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: decisionsKey, exact: true });
      for (const key of ["clarify-suggestions", "task-hints", "stale-work", "project-insights", "cleanup-suggestions", "doc-hints", "today-suggestions"])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useSetDecisionsEnabled = () =>
  useDecisionsMutation((enabled: boolean) => setDecisionsEnabled(enabled));
export const useSetDecisionPrefs = () =>
  useDecisionsMutation((prefs: { goals?: string[]; deepWorkTime?: DeepWorkTime }) => setDecisionPrefs(prefs));
export const useSetTypeSafeKey = () =>
  useDecisionsMutation((key: string) => setTypeSafeKey(key));
export const useRemoveTypeSafeKey = () =>
  useDecisionsMutation<void>(() => removeTypeSafeKey());

/** Suggestions for one Inbox item. Off or unsure returns an empty answer, so
 * the form simply looks like it does today. */
export function useClarifySuggestions(inboxId: string | undefined) {
  return useQuery({
    queryKey: ["clarify-suggestions", inboxId],
    queryFn: () => getClarifySuggestions(inboxId!),
    enabled: Boolean(inboxId),
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
  return useQuery({
    queryKey: ["task-hints", taskId, version],
    queryFn: () => getTaskHints(taskId!),
    enabled: Boolean(taskId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Open Work with no activity for three weeks, with what each likely needs. */
export function useStaleWork(enabled = true) {
  return useQuery({
    queryKey: ["stale-work"],
    queryFn: getStaleWork,
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
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
  return useQuery({
    queryKey: ["project-insights", projectId, version],
    queryFn: () => getProjectInsights(projectId!),
    enabled: Boolean(projectId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useCleanupSuggestions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["cleanup-suggestions", workspaceId],
    queryFn: () => getCleanupSuggestions(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
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
  return useQuery({
    queryKey: ["doc-hints", docId, version],
    queryFn: () => getDocHints(docId!),
    enabled: Boolean(docId) && enabled,
    // Keeps the card up while a newer read loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Today's focus picks and free-gap suggestion; empty while suggestions are off.
 * version changes when Today's focus or plan changes, so picks refresh. */
export function useTodaySuggestions(timezone: string, version = "", enabled = true) {
  return useQuery({
    queryKey: ["today-suggestions", timezone, version],
    queryFn: () => getTodaySuggestions(timezone),
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
