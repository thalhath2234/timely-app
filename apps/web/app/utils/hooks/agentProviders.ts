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

export const agentProvidersKey = ["agent-providers"] as const;

export function useAgentProviders() {
  return useQuery({
    queryKey: agentProvidersKey,
    queryFn: getAgentProviders,
    // Poll while a semantic-search rebuild is running so the count moves.
    refetchInterval: (query) => {
      const status = query.state.data?.reindex?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    },
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
