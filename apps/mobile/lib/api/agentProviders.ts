import { api } from "./client";

export type ProviderId = "openrouter" | "claude" | "codex";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  claude: "Claude Code",
  codex: "Codex",
};

export type CliStatus = {
  found: boolean;
  path?: string;
  version?: string;
  loggedIn: boolean;
  account?: string;
  error?: string;
};

export type CliProviderView = {
  enabled: boolean;
  status: CliStatus;
  connected: boolean;
  connectedAt?: string;
  model: string;
  ready: boolean;
};

export type OpenRouterView = {
  keySet: boolean;
  keyHint?: string;
  serverKey: boolean;
  chatModel: string;
  embedModel: string;
  ready: boolean;
};

export type ReindexState = {
  status?: "queued" | "running" | "done" | "failed" | "";
  done: number;
  total: number;
  error?: string;
};

export type AgentProviders = {
  defaultProvider: ProviderId;
  localCli: boolean;
  openrouter: OpenRouterView;
  claude: CliProviderView;
  codex: CliProviderView;
  reindex: ReindexState;
};

export type ModelOption = {
  id: string;
  name: string;
  vision: boolean;
  default?: boolean;
  note?: string;
};

export type ProviderPatch = {
  defaultProvider?: ProviderId;
  openrouterChatModel?: string;
  openrouterEmbedModel?: string;
  claudeModel?: string;
  codexModel?: string;
};

// Provider changes run test calls on the server and never enter the offline
// mutation queue: a queued key or model change could not report its result.
export const getAgentProviders = () => api<AgentProviders>("/agent/providers");
export const patchAgentProviders = (patch: ProviderPatch) =>
  api<AgentProviders>("/agent/providers", { method: "PATCH", body: patch });
export const listProviderModels = (id: ProviderId, kind?: "embed") =>
  api<ModelOption[]>(
    `/agent/providers/${id}/models${kind ? `?kind=${kind}` : ""}`,
  );
export const connectProvider = (id: "claude" | "codex") =>
  api<AgentProviders>(`/agent/providers/${id}/connect`, { method: "POST" });
export const disconnectProvider = (id: "claude" | "codex") =>
  api<AgentProviders>(`/agent/providers/${id}/disconnect`, { method: "POST" });
export const setOpenRouterKey = (key: string) =>
  api<AgentProviders>("/agent/providers/openrouter/key", {
    method: "POST",
    body: { key },
  });
export const removeOpenRouterKey = () =>
  api<AgentProviders>("/agent/providers/openrouter/key", { method: "DELETE" });
