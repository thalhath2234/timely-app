"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpAddInput, McpUpdateInput } from "@timely/contract/agentMcp";
import {
  addMcpServer,
  getMcpCatalog,
  getMcpServers,
  getMcpTools,
  removeMcpServer,
  startMcpSignIn,
  updateMcpServer,
} from "@/app/utils/api/agentMcp";

/** Every MCP query lives under one key, so a change refetches the list, the catalog's "added" marks and the tools together. */
export const mcpKey = ["agent-mcp"] as const;

/** While `watching` names a server that is not signed in yet, the list is read every 3 seconds. */
export function useMcpServers(watching: string | null = null) {
  return useQuery({
    queryKey: [...mcpKey, "servers"],
    queryFn: getMcpServers,
    staleTime: 15_000,
    refetchInterval: (query) =>
      watching && !query.state.data?.servers.find((s) => s.name === watching)?.signedIn ? 3000 : false,
  });
}

/** The catalog comes from the account's worker: asked once the person opens it, kept for the session. */
export function useMcpCatalog(enabled: boolean) {
  return useQuery({ queryKey: [...mcpKey, "catalog"], queryFn: getMcpCatalog, enabled, staleTime: 10 * 60_000, retry: false });
}

export function useMcpTools(server: string, enabled: boolean) {
  return useQuery({ queryKey: [...mcpKey, "tools", server], queryFn: () => getMcpTools(server), enabled, staleTime: 60_000, retry: false });
}

export function useAddMcpServer() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: McpAddInput) => addMcpServer(input),
    onSuccess: () => void cache.invalidateQueries({ queryKey: mcpKey }),
  });
}

export function useUpdateMcpServer() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: McpUpdateInput }) => updateMcpServer(name, patch),
    onSuccess: () => void cache.invalidateQueries({ queryKey: mcpKey }),
  });
}

export function useRemoveMcpServer() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => removeMcpServer(name),
    onSuccess: () => void cache.invalidateQueries({ queryKey: mcpKey }),
  });
}

export function useMcpSignIn() {
  return useMutation({ mutationFn: (name: string) => startMcpSignIn(name) });
}
