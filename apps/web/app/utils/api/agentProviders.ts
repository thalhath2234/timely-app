import { apiFetch } from "./client";

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
  checkedAt?: string;
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
  updatedAt: string;
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

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(`/agent/providers${path}`, {
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
  return res.json();
}

export const getAgentProviders = () => request<AgentProviders>("");
export const patchAgentProviders = (patch: ProviderPatch) =>
  request<AgentProviders>("", "PATCH", patch);
export const listProviderModels = (id: ProviderId, kind?: "embed") =>
  request<ModelOption[]>(`/${id}/models${kind ? `?kind=${kind}` : ""}`);
export const connectProvider = (id: "claude" | "codex") =>
  request<AgentProviders>(`/${id}/connect`, "POST");
export const disconnectProvider = (id: "claude" | "codex") =>
  request<AgentProviders>(`/${id}/disconnect`, "POST");
export const setOpenRouterKey = (key: string) =>
  request<AgentProviders>("/openrouter/key", "POST", { key });
export const removeOpenRouterKey = () =>
  request<AgentProviders>("/openrouter/key", "DELETE");
