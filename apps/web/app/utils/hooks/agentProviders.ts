import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectProvider,
  disconnectProvider,
  getAgentProviders,
  listProviderModels,
  patchAgentProviders,
  removeApiProviderKey,
  removeOpenRouterKey,
  setApiProviderKey,
  setOpenRouterKey,
  type AgentProviders,
  type ApiProviderId,
  type ProviderId,
  type ProviderPatch,
} from "@/app/utils/api/agentProviders";
import { rescanProviders } from "@/app/utils/api/instance";
import { reindexPollInterval } from "@timely/contract/reindexPoll";

export const agentProvidersKey = ["agent-providers"] as const;

/** The provider overview. Only Settings passes `watchReindex`, so the count
 * of a running semantic-search rebuild moves there (reindexPollInterval);
 * every other screen reads the overview once. */
export function useAgentProviders({ watchReindex = false }: { watchReindex?: boolean } = {}) {
  const since = useRef<number | null>(null);
  return useQuery({
    queryKey: agentProvidersKey,
    queryFn: getAgentProviders,
    refetchInterval: watchReindex
      ? (query) => {
          const status = query.state.data?.reindex?.status;
          if (status !== "queued" && status !== "running") since.current = null;
          else since.current ??= Date.now();
          return reindexPollInterval(status, since.current === null ? 0 : Date.now() - since.current);
        }
      : false,
  });
}

export function useProviderModels(
  id: ProviderId,
  kind?: "embed",
  enabled = true,
) {
  return useQuery({
    queryKey: [...agentProvidersKey, "models", id, kind ?? "chat"],
    queryFn: () => listProviderModels(id, kind),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

function useProviderMutation<TVars>(
  fn: (vars: TVars) => Promise<AgentProviders>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(agentProvidersKey, data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: agentProvidersKey,
        exact: true,
      });
      // The OpenRouter key also powers smart suggestions.
      queryClient.invalidateQueries({ queryKey: ["agent-decisions"] });
    },
  });
}

export const usePatchAgentProviders = () =>
  useProviderMutation((patch: ProviderPatch) => patchAgentProviders(patch));
export const useConnectProvider = () =>
  useProviderMutation((id: "claude" | "codex") => connectProvider(id));
export const useDisconnectProvider = () =>
  useProviderMutation((id: "claude" | "codex") => disconnectProvider(id));
export const useSetOpenRouterKey = () =>
  useProviderMutation((key: string) => setOpenRouterKey(key));
export const useRemoveOpenRouterKey = () =>
  useProviderMutation<void>(() => removeOpenRouterKey());
export const useSetApiProviderKey = () =>
  useProviderMutation(
    (vars: { id: ApiProviderId; key: string; baseUrl?: string }) =>
      setApiProviderKey(vars.id, vars.key, vars.baseUrl),
  );
export const useRemoveApiProviderKey = () =>
  useProviderMutation((id: ApiProviderId) => removeApiProviderKey(id));
/** Drops the server's cached CLI detection and refreshes the provider view. */
export const useRescanProviders = () =>
  useProviderMutation<void>(() => rescanProviders());
