"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
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
  useRemoveOpenRouterKey,
  useRescanProviders,
  useSetOpenRouterKey,
} from "@/app/utils/hooks/agentProviders";
import { useDesktopBridge } from "@/app/utils/hooks/desktop";
import {
  PROVIDER_LABELS,
  type AgentProviders,
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
            ) : data.openrouter.serverKey ? (
              <Badge tone="muted">
                <KeyRound className="size-3" /> Using the server’s key
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
                      "Remove your OpenRouter key? Chats will fall back to the server key if there is one.",
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
              With Claude Code or Codex selected, text, images, receipts and web
              search all go to that provider under your own subscription. The
              zero-data-retention guarantee for private images applies only to
              OpenRouter. If the selected provider is unavailable, the run fails
              with a message — Timely never switches providers silently.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
