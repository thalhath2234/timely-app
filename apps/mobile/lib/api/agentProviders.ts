import { api } from "./client";

export type ApiProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "xai"
  | "mistral"
  | "zai"
  | "kimi"
  | "ollama"
  | "nvidia"
  | "opencode-zen"
  | "opencode-go";

export type ProviderId = "openrouter" | "claude" | "codex" | ApiProviderId;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  claude: "Claude Code",
  codex: "Codex",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  xai: "xAI Grok",
  mistral: "Mistral",
  zai: "Z.ai (GLM)",
  kimi: "Kimi (Moonshot)",
  ollama: "Ollama",
  nvidia: "NVIDIA NIM",
  "opencode-zen": "OpenCode Zen",
  "opencode-go": "OpenCode Go",
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
  chatModel: string;
  embedModel: string;
  ready: boolean;
};

/** A direct API provider: the catalog entry from the server plus this
 * account's connection. Cards render from this, so a new provider needs no
 * UI change. */
export type ApiProviderView = {
  id: ApiProviderId;
  label: string;
  description: string;
  keyUrl: string;
  keyPlaceholder?: string;
  keyOptional: boolean;
  customUrl: boolean;
  search: boolean;
  endpoints: { id: string; label: string; baseUrl: string }[];
  connected: boolean;
  keySet: boolean;
  keyHint?: string;
  baseUrl: string;
  model: string;
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
  apiProviders: ApiProviderView[];
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
  models?: Partial<Record<ApiProviderId, string>>;
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
/** Checks the key by listing models, then saves it. An empty key keeps the
 * saved one so only the endpoint changes. */
export const setApiProviderKey = (
  id: ApiProviderId,
  key: string,
  baseUrl?: string,
) =>
  api<AgentProviders>(`/agent/providers/${id}/key`, {
    method: "POST",
    body: { key, baseUrl },
  });
export const removeApiProviderKey = (id: ApiProviderId) =>
  api<AgentProviders>(`/agent/providers/${id}/key`, { method: "DELETE" });
