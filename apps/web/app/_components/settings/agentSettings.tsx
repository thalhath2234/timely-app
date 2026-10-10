"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
  Globe,
  KeyRound,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldCheck,
  TerminalSquare,
  Unplug,
} from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import {
  useAgentProviders,
  useConnectProvider,
  useDisconnectProvider,
  usePatchAgentProviders,
  useProviderModels,
  useRemoveApiProviderKey,
  useRemoveOpenRouterKey,
  useRescanProviders,
  useSetApiProviderKey,
  useSetOpenRouterKey,
} from "@/app/utils/hooks/agentProviders";
import {
  useDecisions,
  useLearned,
  usePersonalPrefs,
  useResetLearned,
  useSaveUseCase,
  useRemoveTypeSafeKey,
  useSetDecisionPrefs,
  useSetDecisionsEnabled,
  useSetTypeSafeKey,
  useTestDecisions,
} from "@/app/utils/hooks/decisions";
import { useDesktopBridge } from "@/app/utils/hooks/desktop";
import type { DecisionsView, DeepWorkTime } from "@/app/utils/api/decisions";
import Select from "@/app/_components/_ui/select";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type ApiProviderView,
  type CliProviderView,
  type ModelOption,
  type ProviderId,
} from "@/app/utils/api/agentProviders";

export const CLI_INSTALL_URLS = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
  codex: "https://github.com/openai/codex",
} as const;

const inputClass =
  "w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40 disabled:opacity-60";
const primaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-60";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/** Searchable model picker. Saving runs a test call on the server, so the
 * change is confirmed only after the provider answered. */
export function ModelPicker({
  value,
  options,
  loading,
  loadError,
  onSave,
  saving,
  allowCustom,
  placeholder,
  label,
}: {
  value: string;
  options: ModelOption[] | undefined;
  loading?: boolean;
  loadError?: string | null;
  onSave: (model: string) => Promise<unknown>;
  saving?: boolean;
  allowCustom?: boolean;
  placeholder?: string;
  label: string;
}) {
  const [query, setQuery] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Follow the saved value when it changes (derived during render, not in an effect).
  if (lastValue !== value) {
    setLastValue(value);
    setQuery(value);
  }
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = useMemo(() => {
    const list = options ?? [];
    const needle = query.trim().toLowerCase();
    const matches =
      needle && needle !== value.toLowerCase()
        ? list.filter(
            (option) =>
              option.id.toLowerCase().includes(needle) ||
              option.name.toLowerCase().includes(needle),
          )
        : list;
    return matches.slice(0, 80);
  }, [options, query, value]);

  const current = options?.find((option) => option.id === value);
  const dirty = query.trim() !== "" && query.trim() !== value;

  const save = async (model: string) => {
    setError(null);
    try {
      await onSave(model);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Could not save this model."));
    }
  };

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && dirty && allowCustom) {
                event.preventDefault();
                void save(query.trim());
              }
            }}
            placeholder={placeholder ?? "Search models…"}
            aria-label={label}
            className={cn(inputClass, "pl-8")}
            disabled={saving}
          />
        </div>
        {saving && (
          <LogoSpinner size={16} className="text-muted-foreground" label="Saving" />
        )}
        {!saving && dirty && allowCustom && (
          <button
            type="button"
            onClick={() => void save(query.trim())}
            className={secondaryButton}
          >
            Use this name
          </button>
        )}
      </div>
      {current?.vision && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Eye className="size-3" /> Accepts images
        </span>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {loading && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Loading models…
            </p>
          )}
          {loadError && (
            <p className="px-2 py-1.5 text-xs text-destructive">{loadError}</p>
          )}
          {!loading && !loadError && filtered.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {allowCustom
                ? "No matches — press Enter to use the typed name."
                : "No matches."}
            </p>
          )}
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => void save(option.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                option.id === value && "bg-primary/10",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">
                  {option.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {option.id}
                  {option.note ? ` · ${option.note}` : ""}
                </span>
              </span>
              {option.vision && (
                <Eye className="size-3 shrink-0 text-muted-foreground" />
              )}
              {option.id === value && (
                <Check className="size-3.5 shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "primary" | "danger";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "ok" &&
          "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "bg-amber-500/12 text-amber-700 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "primary" && "bg-primary/12 text-primary",
        tone === "danger" && "bg-destructive/12 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

function ProviderCard({
  id,
  title,
  description,
  isDefault,
  ready,
  onMakeDefault,
  makingDefault,
  children,
}: {
  id: ProviderId;
  title: string;
  description: string;
  isDefault: boolean;
  ready: boolean;
  onMakeDefault: () => void;
  makingDefault: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-provider={id}
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-4",
        isDefault ? "border-primary/40 bg-primary/[0.03]" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {isDefault && <Badge tone="primary">Default</Badge>}
            {!isDefault && ready && <Badge tone="ok">Ready</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={onMakeDefault}
            disabled={!ready || makingDefault}
            title={
              ready
                ? "Use this provider for new chats"
                : "Connect this provider first"
            }
            className={secondaryButton}
          >
            {makingDefault ? <LogoSpinner size={14} label="Saving" /> : null}
            Use as default
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function OpenRouterCard({ data }: { data: AgentProviders }) {
  const patch = usePatchAgentProviders();
  const setKey = useSetOpenRouterKey();
  const removeKey = useRemoveOpenRouterKey();
  const chatModels = useProviderModels("openrouter");
  const embedModels = useProviderModels("openrouter", "embed");
  const [editingKey, setEditingKey] = useState(!data.openrouter.keySet);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const onSaveKey = async (event: FormEvent) => {
    event.preventDefault();
    setKeyError(null);
    try {
      await setKey.mutateAsync(key.trim());
      setKeyValue("");
      setEditingKey(false);
    } catch (err) {
      setKeyError(errorMessage(err, "Could not save the key."));
    }
  };

  const reindex = data.reindex;
  const reindexActive =
    reindex.status === "queued" || reindex.status === "running";

  return (
    <ProviderCard
      id="openrouter"
      title="OpenRouter"
      description="Hosted models with your own API key. Images and receipts use OpenRouter's zero-data-retention route."
      isDefault={data.defaultProvider === "openrouter"}
      ready={data.openrouter.ready}
      onMakeDefault={() => patch.mutate({ defaultProvider: "openrouter" })}
      makingDefault={
        patch.isPending && patch.variables?.defaultProvider === "openrouter"
      }
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">API key</span>
        {!editingKey ? (
          <div className="flex flex-wrap items-center gap-2">
            {data.openrouter.keySet ? (
              <Badge tone="ok">
                <KeyRound className="size-3" /> Key saved{" "}
                {data.openrouter.keyHint}
              </Badge>
            ) : (
              <Badge tone="warn">
                <CircleAlert className="size-3" /> No key
              </Badge>
            )}
            <button
              type="button"
              onClick={() => setEditingKey(true)}
              className={secondaryButton}
            >
              {data.openrouter.keySet ? "Replace" : "Add key"}
            </button>
            {data.openrouter.keySet && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove your OpenRouter key? OpenRouter chats and semantic search stop until you add one again.",
                    )
                  ) {
                    removeKey.mutate();
                  }
                }}
                disabled={removeKey.isPending}
                className="inline-flex h-9 items-center rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={onSaveKey} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKeyValue(event.target.value)}
                placeholder="sk-or-v1-…"
                aria-label="OpenRouter API key"
                className={inputClass}
                disabled={setKey.isPending}
              />
              <button
                type="submit"
                disabled={key.trim().length < 8 || setKey.isPending}
                className={primaryButton}
              >
                {setKey.isPending ? (
                  <LogoSpinner size={14} tone="mono" label="Checking" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {setKey.isPending ? "Checking…" : "Save"}
              </button>
              {data.openrouter.keySet && (
                <button
                  type="button"
                  onClick={() => setEditingKey(false)}
                  className={secondaryButton}
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted on the server and never shown again. Saving sends
              one tiny test request.
            </p>
            {keyError && <p className="text-xs text-destructive">{keyError}</p>}
          </form>
        )}
      </div>

      <ModelPicker
        label="Chat model"
        value={data.openrouter.chatModel}
        options={chatModels.data}
        loading={chatModels.isLoading}
        loadError={
          chatModels.error
            ? errorMessage(chatModels.error, "Could not load models.")
            : null
        }
        saving={
          patch.isPending && patch.variables?.openrouterChatModel !== undefined
        }
        onSave={(model) => patch.mutateAsync({ openrouterChatModel: model })}
        allowCustom
        placeholder="Search tool-calling models…"
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/30 p-3">
        <ModelPicker
          label="Semantic search embedding model"
          value={data.openrouter.embedModel}
          options={embedModels.data}
          loading={embedModels.isLoading}
          loadError={
            embedModels.error
              ? errorMessage(embedModels.error, "Could not load models.")
              : null
          }
          saving={
            patch.isPending &&
            patch.variables?.openrouterEmbedModel !== undefined
          }
          onSave={(model) => patch.mutateAsync({ openrouterEmbedModel: model })}
          placeholder="Search embedding models…"
        />
        <p className="text-[11px] text-muted-foreground">
          Must produce 1536-dimension vectors. Changing the key or model
          rebuilds your search index in the background.
        </p>
        {reindexActive && (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="reindex-progress"
          >
            <LogoSpinner size={14} label="Rebuilding" />
            Rebuilding search index… {reindex.done}
            {reindex.total ? ` / ${reindex.total}` : ""}
          </div>
        )}
        {reindex.status === "done" && (
          <p className="text-xs text-muted-foreground">
            Search index up to date ({reindex.total} items).
          </p>
        )}
        {reindex.status === "failed" && (
          <p className="text-xs text-destructive">
            Index rebuild failed: {reindex.error}
          </p>
        )}
      </div>
    </ProviderCard>
  );
}

const CUSTOM_ENDPOINT = "custom";

/** A direct API provider (Anthropic, OpenAI, Gemini, DeepSeek, …). Rendered
 * from the server's catalog; until a key is saved it stays one compact row. */
function ApiProviderCard({
  data,
  view,
}: {
  data: AgentProviders;
  view: ApiProviderView;
}) {
  const patch = usePatchAgentProviders();
  const setKey = useSetApiProviderKey();
  const removeKey = useRemoveApiProviderKey();
  const models = useProviderModels(view.id, undefined, view.connected);
  const [opened, setOpen] = useState(false);
  const open = opened || view.connected;
  const [editingKey, setEditingKey] = useState(!view.connected);
  const [key, setKeyValue] = useState("");
  const matched = view.endpoints.find(
    (endpoint) => endpoint.baseUrl === view.baseUrl,
  );
  const [endpoint, setEndpoint] = useState(
    matched?.id ?? (view.customUrl ? CUSTOM_ENDPOINT : view.endpoints[0]?.id),
  );
  const [customUrl, setCustomUrl] = useState(matched ? "" : view.baseUrl);
  const [keyError, setKeyError] = useState<string | null>(null);
  const showEndpoints = view.endpoints.length > 1 || view.customUrl;
  const baseUrl =
    endpoint === CUSTOM_ENDPOINT
      ? customUrl.trim()
      : view.endpoints.find((item) => item.id === endpoint)?.baseUrl;
  const endpointChanged = (baseUrl ?? "") !== view.baseUrl;
  const canSave =
    !setKey.isPending &&
    (key.trim().length >= 8 ||
      (view.connected && endpointChanged && key.trim() === "") ||
      (view.keyOptional && key.trim() === ""));

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setKeyError(null);
    try {
      await setKey.mutateAsync({ id: view.id, key: key.trim(), baseUrl });
      setKeyValue("");
      setEditingKey(false);
    } catch (err) {
      setKeyError(errorMessage(err, "Could not save the key."));
    }
  };

  if (!open) {
    return (
      <div
        data-provider={view.id}
        className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{view.label}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {view.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(secondaryButton, "shrink-0")}
        >
          <KeyRound className="size-3.5" />
          {view.keyOptional ? "Set up" : "Add key"}
        </button>
      </div>
    );
  }

  return (
    <ProviderCard
      id={view.id}
      title={view.label}
      description={view.description}
      isDefault={data.defaultProvider === view.id}
      ready={view.ready}
      onMakeDefault={() => patch.mutate({ defaultProvider: view.id })}
      makingDefault={patch.isPending && patch.variables?.defaultProvider === view.id}
    >
      {!editingKey ? (
        <div className="flex flex-wrap items-center gap-2">
          {view.keySet ? (
            <Badge tone="ok">
              <KeyRound className="size-3" /> Key saved {view.keyHint}
            </Badge>
          ) : (
            <Badge tone="muted">No key needed</Badge>
          )}
          {showEndpoints && (
            <Badge tone="muted">
              <Globe className="size-3" /> {matched?.label ?? view.baseUrl}
            </Badge>
          )}
          <button
            type="button"
            onClick={() => setEditingKey(true)}
            className={secondaryButton}
          >
            {view.keySet ? "Replace" : "Change"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Disconnect ${view.label}? The saved key is deleted.`,
                )
              ) {
                removeKey.mutate(view.id, {
                  onSuccess: () => {
                    setOpen(false);
                    setEditingKey(true);
                  },
                });
              }
            }}
            disabled={removeKey.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10"
          >
            <Unplug className="size-3.5" /> Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={onSave} className="flex flex-col gap-2">
          {showEndpoints && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Endpoint</span>
              <select
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                className={inputClass}
                disabled={setKey.isPending}
              >
                {view.endpoints.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
                {view.customUrl && (
                  <option value={CUSTOM_ENDPOINT}>Another address…</option>
                )}
              </select>
            </label>
          )}
          {endpoint === CUSTOM_ENDPOINT && (
            <input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              placeholder="http://192.168.1.20:11434"
              aria-label={`${view.label} address`}
              className={inputClass}
              disabled={setKey.isPending}
            />
          )}
          <div className="flex items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => setKeyValue(event.target.value)}
              placeholder={
                view.keySet
                  ? "Leave empty to keep the saved key"
                  : view.keyOptional
                    ? "API key (only for Ollama Cloud)"
                    : (view.keyPlaceholder ?? "API key")
              }
              aria-label={`${view.label} API key`}
              className={inputClass}
              disabled={setKey.isPending}
            />
            <button type="submit" disabled={!canSave} className={primaryButton}>
              {setKey.isPending ? (
                <LogoSpinner size={14} tone="mono" label="Checking" />
              ) : (
                <Check className="size-3.5" />
              )}
              {setKey.isPending ? "Checking…" : view.connected ? "Save" : "Connect"}
            </button>
            <button
              type="button"
              onClick={() => {
                setKeyError(null);
                if (view.connected) setEditingKey(false);
                else setOpen(false);
              }}
              className={secondaryButton}
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored encrypted on the server and never shown again. Saving checks
            the key with the provider.{" "}
            <a
              href={view.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Get a key
            </a>
          </p>
          {keyError && <p className="text-xs text-destructive">{keyError}</p>}
        </form>
      )}

      {view.connected && (
        <ModelPicker
          label="Chat model"
          value={view.model}
          options={models.data}
          loading={models.isLoading}
          loadError={
            models.error
              ? errorMessage(models.error, "Could not load models.")
              : null
          }
          saving={
            patch.isPending && patch.variables?.models?.[view.id] !== undefined
          }
          onSave={(model) => patch.mutateAsync({ models: { [view.id]: model } })}
          allowCustom
          placeholder="Search models…"
        />
      )}
      {!view.search && (
        <p className="text-[11px] text-muted-foreground">
          No web search with this provider: chats that have it switched on
          answer without it.
        </p>
      )}
    </ProviderCard>
  );
}

function CliCard({
  id,
  data,
  view,
}: {
  id: "claude" | "codex";
  data: AgentProviders;
  view: CliProviderView;
}) {
  const patch = usePatchAgentProviders();
  const connect = useConnectProvider();
  const disconnect = useDisconnectProvider();
  const rescan = useRescanProviders();
  const desktop = useDesktopBridge() !== null;
  const models = useProviderModels(
    id,
    undefined,
    view.connected || view.status.found,
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const status = view.status;
  const loginCommand = id === "claude" ? "claude auth login" : "codex login";
  const host = desktop ? "this computer" : "the server";

  const onConnect = async () => {
    setConnectError(null);
    try {
      await connect.mutateAsync(id);
    } catch (err) {
      setConnectError(errorMessage(err, "Could not connect."));
    }
  };

  return (
    <ProviderCard
      id={id}
      title={PROVIDER_LABELS[id]}
      description={
        id === "claude"
          ? `Uses the Claude Code CLI and its sign-in on ${host}. Runs with every built-in tool disabled.`
          : `Uses the Codex CLI and its sign-in on ${host}. Runs in a read-only sandbox with the shell disabled.`
      }
      isDefault={data.defaultProvider === id}
      ready={view.ready}
      onMakeDefault={() => patch.mutate({ defaultProvider: id })}
      makingDefault={patch.isPending && patch.variables?.defaultProvider === id}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {status.found ? (
            <Badge tone="ok">
              <TerminalSquare className="size-3" /> Found{" "}
              {status.version ? `· ${status.version}` : ""}
            </Badge>
          ) : (
            <Badge tone="warn">
              <CircleAlert className="size-3" /> Not found on {host}
            </Badge>
          )}
          {status.found && status.loggedIn && (
            <Badge tone="ok">
              <ShieldCheck className="size-3" /> Signed in
              {status.account ? ` · ${status.account}` : ""}
            </Badge>
          )}
          {status.found && !status.loggedIn && (
            <Badge tone="warn">
              <CircleAlert className="size-3" /> Not signed in
            </Badge>
          )}
          {view.connected && <Badge tone="primary">Connected</Badge>}
        </div>
        {status.path && (
          <p
            className="truncate text-[11px] text-muted-foreground"
            title={status.path}
          >
            {status.path}
          </p>
        )}
        {!status.found && desktop && (
          <p className="text-xs text-muted-foreground">
            Install the CLI on this computer and sign in from a terminal, then
            Re-scan.
          </p>
        )}
        {!status.found && !desktop && (
          <p className="text-xs text-muted-foreground">
            Install the CLI for the OS user that runs the Timely API. If it
            lives somewhere unusual, set{" "}
            <code>{id === "claude" ? "CLAUDE_BIN" : "CODEX_BIN"}</code> in the
            server <code>.env</code>. The path cannot be set from here.
          </p>
        )}
        {status.found && !status.loggedIn && (
          <p className="text-xs text-muted-foreground">
            Run <code>{loginCommand}</code> in a terminal on {host}, then
            press Connect.
          </p>
        )}
        {!status.found && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={CLI_INSTALL_URLS[id]}
              target="_blank"
              rel="noreferrer"
              className={secondaryButton}
            >
              <ExternalLink className="size-3.5" />
              {id === "claude" ? "Install Claude Code" : "Install Codex"}
            </a>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={connect.isPending}
            className={view.connected ? secondaryButton : primaryButton}
          >
            {connect.isPending ? (
              <LogoSpinner size={14} tone={view.connected ? "brand" : "mono"} label="Checking" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {connect.isPending
              ? "Checking…"
              : view.connected
                ? "Reconnect"
                : "Connect"}
          </button>
          <button
            type="button"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
            title="Look for the CLI again after installing or signing in"
            className={secondaryButton}
          >
            {rescan.isPending ? (
              <LogoSpinner size={14} label="Scanning" />
            ) : (
              <ScanSearch className="size-3.5" />
            )}
            {rescan.isPending ? "Scanning…" : "Re-scan"}
          </button>
          {view.connected && (
            <button
              type="button"
              onClick={() => disconnect.mutate(id)}
              disabled={disconnect.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Unplug className="size-3.5" /> Disconnect
            </button>
          )}
        </div>
        {connectError && (
          <p className="text-xs text-destructive">{connectError}</p>
        )}
        {rescan.error && (
          <p className="text-xs text-destructive">
            {errorMessage(rescan.error, "Could not re-scan.")}
          </p>
        )}
        {view.connected && (
          <p className="text-[11px] text-muted-foreground">
            Connect ran a one-word test call
            {view.connectedAt
              ? ` on ${new Date(view.connectedAt).toLocaleString()}`
              : ""}
            .
          </p>
        )}
      </div>

      <ModelPicker
        label="Model"
        value={view.model}
        options={models.data}
        loading={models.isLoading}
        loadError={
          models.error
            ? errorMessage(models.error, "Could not load models.")
            : null
        }
        saving={
          patch.isPending &&
          patch.variables?.[id === "claude" ? "claudeModel" : "codexModel"] !==
            undefined
        }
        onSave={(model) =>
          patch.mutateAsync(
            id === "claude" ? { claudeModel: model } : { codexModel: model },
          )
        }
        allowCustom
        placeholder={
          id === "claude"
            ? "fable, opus, sonnet, haiku or a full model name"
            : "Search models…"
        }
      />
    </ProviderCard>
  );
}

const TYPESAFE_KEY_URL = "https://typesafe.ai";

/** Smart suggestions run on Jev, TypeSafe's small decision model. A TypeSafe
 * key is used first; without one the OpenRouter key above is used. With
 * neither, the app works exactly as before. */
function DecisionsCard() {
  const { data, isLoading, error } = useDecisions();
  const setEnabled = useSetDecisionsEnabled();
  const setKey = useSetTypeSafeKey();
  const removeKey = useRemoveTypeSafeKey();
  const test = useTestDecisions();
  const [editingKey, setEditingKey] = useState(false);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const onSaveKey = async (event: FormEvent) => {
    event.preventDefault();
    setKeyError(null);
    try {
      await setKey.mutateAsync(key.trim());
      setKeyValue("");
      setEditingKey(false);
    } catch (err) {
      setKeyError(errorMessage(err, "Could not save the key."));
    }
  };

  if (isLoading) return null;
  if (error || !data) {
    return (
      <p className="text-xs text-destructive">
        {errorMessage(error, "Could not load smart suggestions.")}
      </p>
    );
  }

  const ts = data.typesafe;
  const showForm = editingKey || (!ts.keySet && !data.openrouterKeySet);
  let source: string;
  if (!data.enabled) source = "Off. Timely works as it does without them.";
  else if (data.provider === "typesafe") source = "Using your TypeSafe key.";
  else if (data.provider === "openrouter")
    source = ts.rejected
      ? "TypeSafe refused your key, so your OpenRouter key is used for now."
      : "Using your OpenRouter key. A TypeSafe key is used first when you add one.";
  else source = "Add a TypeSafe or OpenRouter key to turn these on.";

  return (
    <section
      data-testid="decisions-card"
      className="flex flex-col gap-4 rounded-xl border border-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id="decisions-title" className="text-sm font-semibold text-foreground">
              Smart suggestions
            </h3>
            {data.available ? (
              <Badge tone="ok">On</Badge>
            ) : (
              <Badge tone="muted">Off</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pre-fills the Clarify form for Inbox items and estimates how long
            new work takes. In agent chat it narrows the tools the agent gets,
            points you to an earlier chat about the same thing and flags
            changes worth a check before you apply them. For receipts it
            picks a category and sheet you already use and notes likely
            repeats; it also suggests a template for a new sheet and column
            types for an imported CSV from a few of its values. On tasks and
            projects it suggests a status, stage, fields or blocker from the
            description, lists work idle for three weeks, reads how a project
            is going and spots labels or statuses that mean the same. In docs
            it suggests where a doc belongs, its type, properties and a
            template, lines that could be tasks, a link for selected text and
            headings for a plain-text import, and notes a doc that looks out
            of date. On Today it picks work worth focusing on and the best
            task for your next free gap; it reads how urgent each task sounds
            for Auto-schedule, keeps related work together, and suggests a
            next step for missed or overdue work. Receipt photos
            and receipt amounts are never sent. Runs on Jev, TypeSafe&apos;s
            fast decision model.
            Suggestions never change anything until you save or apply.
          </p>
          <p className="mt-1 text-xs text-foreground" data-testid="decisions-source">
            {source}
          </p>
          {data.available && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => test.mutate()}
                disabled={test.isPending}
                className={secondaryButton}
              >
                {test.isPending && <LogoSpinner size={14} label="Testing" />}
                Test
              </button>
              {test.data && (
                <span
                  data-testid="decisions-test-result"
                  className={cn(
                    "text-xs",
                    test.data.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
                  )}
                >
                  {test.data.ok
                    ? `Working: ${test.data.provider === "typesafe" ? "TypeSafe" : "OpenRouter"} answered in ${test.data.latencyMs} ms.`
                    : test.data.error}
                </span>
              )}
              {test.error && (
                <span className="text-xs text-destructive">
                  {errorMessage(test.error, "Could not run the test.")}
                </span>
              )}
            </div>
          )}
        </div>
        <label
          className={cn(
            "relative inline-flex shrink-0 items-center",
            setEnabled.isPending ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <input
            type="checkbox"
            role="switch"
            aria-checked={data.enabled}
            aria-labelledby="decisions-title"
            className="peer sr-only"
            checked={data.enabled}
            disabled={setEnabled.isPending}
            onChange={(event) => setEnabled.mutate(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className="relative block h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-4"
          >
            <span className="absolute left-0.5 top-0.5 block size-4 rounded-full bg-background shadow transition-transform" />
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">TypeSafe API key</span>
        {!showForm ? (
          <div className="flex flex-wrap items-center gap-2">
            {ts.keySet ? (
              ts.rejected ? (
                <Badge tone="danger">
                  <CircleAlert className="size-3" /> Key refused {ts.keyHint}
                </Badge>
              ) : (
                <Badge tone="ok">
                  <KeyRound className="size-3" /> Key saved {ts.keyHint}
                </Badge>
              )
            ) : (
              <Badge tone="muted">No key</Badge>
            )}
            <button
              type="button"
              onClick={() => setEditingKey(true)}
              className={secondaryButton}
            >
              {ts.keySet ? "Replace" : "Add key"}
            </button>
            {ts.keySet && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      data.openrouterKeySet
                        ? "Remove your TypeSafe key? Suggestions will use your OpenRouter key."
                        : "Remove your TypeSafe key? Smart suggestions stop until you add a key again.",
                    )
                  ) {
                    removeKey.mutate();
                  }
                }}
                disabled={removeKey.isPending}
                className="inline-flex h-9 items-center rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10"
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={onSaveKey} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKeyValue(event.target.value)}
                placeholder="TypeSafe API key"
                aria-label="TypeSafe API key"
                className={inputClass}
                disabled={setKey.isPending}
              />
              <button
                type="submit"
                disabled={key.trim().length < 8 || setKey.isPending}
                className={primaryButton}
              >
                {setKey.isPending ? (
                  <LogoSpinner size={14} tone="mono" label="Checking" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {setKey.isPending ? "Checking…" : "Save"}
              </button>
              {editingKey && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingKey(false);
                    setKeyError(null);
                  }}
                  className={secondaryButton}
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Optional when your OpenRouter key is set. Stored encrypted and
              never shown again; saving sends one tiny test request.{" "}
              <a
                href={TYPESAFE_KEY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline"
              >
                Get a key <ExternalLink className="size-3" />
              </a>
            </p>
            {keyError && <p className="text-xs text-destructive">{keyError}</p>}
          </form>
        )}
        {(setEnabled.error || removeKey.error) && (
          <p className="text-xs text-destructive">
            {errorMessage(setEnabled.error ?? removeKey.error, "Could not save.")}
          </p>
        )}
      </div>
      {data.enabled && <DecisionPrefs data={data} />}
      {data.enabled && <UseCaseField />}
      {data.enabled && <LearnedDefaults />}
    </section>
  );
}

/** What the person uses Timely for, in their own words. Starter labels in
 * workspace settings are picked from it. */
function UseCaseField() {
  const prefs = usePersonalPrefs();
  const save = useSaveUseCase();
  const saved = prefs.data?.prefs.useCase ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const dirty = value.trim() !== saved;
  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await save.mutateAsync(value.trim());
      setDraft(null);
    } catch {
      // The error shows below.
    }
  };
  return (
    <form onSubmit={onSave} className="flex flex-col gap-1.5 border-t border-border pt-4" data-testid="use-case">
      <label htmlFor="use-case" className="text-xs text-muted-foreground">
        What you use Timely for
      </label>
      <input
        id="use-case"
        value={value}
        maxLength={300}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Running a bakery and studying for a design course"
        className={inputClass}
        disabled={save.isPending || prefs.isLoading}
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!dirty || save.isPending} className={secondaryButton}>
          Save
        </button>
        <span className="text-[11px] text-muted-foreground">
          Workspace settings suggest starter labels that fit it.
        </span>
      </div>
      {save.error && <p className="text-xs text-destructive">{errorMessage(save.error, "Could not save.")}</p>}
    </form>
  );
}

/** Names for the features that learn from what the person keeps. */
const LEARNED_NAMES: Record<string, string> = {
  clarify: "Clarify form",
  doc_mention: "Link selection to an item",
  project_template: "Start from a template",
  sheet_template: "Sheet templates",
  search: "Search",
  screen_tip: "Screen tips",
  chat_prompts: "Chat example prompts",
  starter_labels: "Starter labels",
  today: "Today suggestions",
  task_hints: "Task hints",
  stale_work: "Stale work",
  project_insights: "Project insights",
  project_move: "Move to project",
  taxonomy_cleanup: "Merge suggestions",
  doc_hints: "Doc suggestions",
  receipt: "Receipts",
  smart_alerts: "Smart alerts",
  dashboard_highlights: "Dashboard highlights",
};

/** How often the person kept each feature's suggestions. A feature whose
 * suggestions were mostly changed now waits until it is surer. */
function LearnedDefaults() {
  const learned = useLearned();
  const reset = useResetLearned();
  const rows = learned.data?.features ?? [];
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="decisions-learned">
      <div>
        <p className="text-sm font-medium">What suggestions learned</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When you change most of a feature&apos;s suggestions, it suggests only when it is surer. Counts cover the last 20 answers in 30 days.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.feature} className="flex items-center justify-between gap-3 text-xs">
            <span>
              <span className="font-medium text-foreground">{LEARNED_NAMES[row.feature] ?? row.feature}</span>
              <span className="text-muted-foreground"> · kept {row.kept} of {row.decided}</span>
              {row.raise > 0 ? <span className="text-amber-600 dark:text-amber-400"> · now asks for more certainty</span> : null}
            </span>
            {row.raise > 0 ? (
              <button
                type="button"
                disabled={reset.isPending}
                onClick={() => reset.mutate(row.feature)}
                className="shrink-0 rounded-md px-2 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                Reset
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MAX_GOALS = 5;

/** What suggestions weigh on Today and in task hints: the person's goals and
 * their best time of day for deep work. */
function DecisionPrefs({ data }: { data: DecisionsView }) {
  const save = useSetDecisionPrefs();
  const saved = (data.goals ?? []).join("\n");
  const [goals, setGoals] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const lines = goals.split("\n").map((line) => line.trim()).filter(Boolean);
  const dirty = lines.join("\n") !== saved;

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (lines.length > MAX_GOALS) {
      setError(`Add up to ${MAX_GOALS} goals.`);
      return;
    }
    try {
      const next = await save.mutateAsync({ goals: lines });
      setGoals(next.goals.join("\n"));
    } catch (err) {
      setError(errorMessage(err, "Could not save your goals."));
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="decision-prefs">
      <form onSubmit={onSave} className="flex flex-col gap-1.5">
        <label htmlFor="decision-goals" className="text-xs text-muted-foreground">
          Your goals, one per line (up to {MAX_GOALS})
        </label>
        <textarea
          id="decision-goals"
          rows={3}
          value={goals}
          onChange={(event) => setGoals(event.target.value)}
          placeholder={"Launch the online shop\nRun a half marathon"}
          className={cn(inputClass, "resize-y")}
          disabled={save.isPending}
        />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={!dirty || save.isPending} className={secondaryButton}>
            Save goals
          </button>
          <span className="text-[11px] text-muted-foreground">
            Today shows which of your open work moves each goal forward.
          </span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Best time for deep work</span>
        <div className="max-w-xs">
          <Select
            aria-label="Best time for deep work"
            value={data.deepWorkTime ?? ""}
            onChange={(value) => save.mutate({ deepWorkTime: value as DeepWorkTime })}
            disabled={save.isPending}
            options={[
              { value: "", label: "No preference" },
              { value: "morning", label: "Mornings" },
              { value: "afternoon", label: "Afternoons" },
              { value: "evening", label: "Evenings" },
            ]}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          Deep focus tasks get a hint to plan them at this time of day.
        </span>
      </div>
    </div>
  );
}

export default function AgentSettings() {
  const { data, isLoading, error, refetch } = useAgentProviders();
  const patch = usePatchAgentProviders();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Agent</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which model runs the in-app assistant. New chats use the
          default provider and its model; a run already in progress finishes on
          the provider it started with.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Checking providers…</p>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {errorMessage(error, "Could not load provider settings.")}
          <button
            type="button"
            onClick={() => refetch()}
            className={secondaryButton}
          >
            Retry
          </button>
        </div>
      )}
      {patch.error && (
        <p className="text-sm text-destructive">
          {errorMessage(patch.error, "Could not save.")}
        </p>
      )}

      {data && (
        <>
          <OpenRouterCard data={data} />
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Direct API providers
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Use a provider&apos;s own API key instead of OpenRouter. Saving a
                key checks it; choosing a model or making it the default sends
                one tiny test request.
              </p>
            </div>
            {data.apiProviders.map((view) => (
              <ApiProviderCard key={view.id} data={data} view={view} />
            ))}
          </div>
          <DecisionsCard />
          {data.localCli ? (
            <>
              <CliCard id="claude" data={data} view={data.claude} />
              <CliCard id="codex" data={data} view={data.codex} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Claude Code and Codex are turned off on this server (
              <code>CHAT_LOCAL_CLI=off</code>).
            </p>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Privacy</p>
            <p className="mt-1">
              With Claude Code, Codex or a direct API provider selected, text,
              images, receipts and web search all go to that provider under your
              own subscription or key. The zero-data-retention guarantee for
              private images applies only to OpenRouter. If the selected provider is unavailable, the run fails
              with a message — Timely never switches providers silently.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
