import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getClarifySuggestions,
  getDecisions,
  removeTypeSafeKey,
  sendDecisionFeedback,
  setDecisionsEnabled,
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
      queryClient.invalidateQueries({ queryKey: ["clarify-suggestions"] });
    },
  });
}

export const useSetDecisionsEnabled = () =>
  useDecisionsMutation((enabled: boolean) => setDecisionsEnabled(enabled));
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
