"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Eye, Search } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type ProviderId,
} from "@/app/utils/api/agentProviders";
import {
  useAgentProviders,
  useProviderModels,
} from "@/app/utils/hooks/agentProviders";

/** A model picked for one conversation; an empty provider follows the
 * account default in Settings → Agent. */
export type ModelChoice = { provider: string; model: string };

/** Connected providers with the model each one runs by default. */
export function readyProviders(data: AgentProviders | undefined) {
  if (!data) return [];
  const list: { id: ProviderId; model: string }[] = [];
  if (data.openrouter.ready)
    list.push({ id: "openrouter", model: data.openrouter.chatModel });
  if (data.localCli && data.claude.ready)
    list.push({ id: "claude", model: data.claude.model });
  if (data.localCli && data.codex.ready)
    list.push({ id: "codex", model: data.codex.model });
  for (const api of data.apiProviders ?? [])
    if (api.ready) list.push({ id: api.id, model: api.model });
  return list;
}

const label = (id: string) => PROVIDER_LABELS[id as ProviderId] ?? id;

export default function ModelMenu({
  value,
  onChange,
  disabled,
  placement = "up",
}: {
  value: ModelChoice;
  onChange: (next: ModelChoice) => void;
  disabled?: boolean;
  placement?: "up" | "down";
}) {
  const providers = useAgentProviders();
  const ready = readyProviders(providers.data);
  const defaultId = providers.data?.defaultProvider;
  const defaultModel = ready.find((p) => p.id === defaultId)?.model ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<string>("");
  const wrap = useRef<HTMLDivElement>(null);
  const shown =
    (ready.some((p) => p.id === browsing) && browsing) ||
    value.provider ||
    defaultId ||
    ready[0]?.id ||
    "";
  const models = useProviderModels(
    shown as ProviderId,
    undefined,
    open && ready.some((p) => p.id === shown),
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = models.data ?? [];
    return (
      needle
        ? list.filter(
            (m) =>
              m.id.toLowerCase().includes(needle) ||
              m.name.toLowerCase().includes(needle),
          )
        : list
    ).slice(0, 80);
  }, [models.data, query]);

  const pick = (next: ModelChoice) => {
    setOpen(false);
    setQuery("");
    if (next.provider !== value.provider || next.model !== value.model)
      onChange(next);
  };
  const current = value.provider
    ? value.model || label(value.provider)
    : defaultModel
      ? `Default · ${defaultModel}`
      : "Default model";

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setBrowsing("");
          setOpen((o) => !o);
        }}
        title={
          value.provider
            ? `${label(value.provider)}${value.model ? ` · ${value.model}` : ""} for this conversation`
            : "Uses the default model from Settings → Agent"
        }
        className={cn(
          "inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-50",
          value.provider
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Cpu className="size-4 shrink-0" />
        <span className="truncate">{current}</span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose a model"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Close only the menu, not the chat dialog around it.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
          className={cn(
            "absolute left-0 z-30 flex max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg",
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <button
            type="button"
            onClick={() => pick({ provider: "", model: "" })}
            className="flex items-start gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-foreground">Default</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {defaultId
                  ? `${label(defaultId)}${defaultModel ? ` · ${defaultModel}` : ""}`
                  : "Set in Settings → Agent"}
              </span>
            </span>
            {!value.provider && (
              <Check className="mt-0.5 size-4 text-primary" />
            )}
          </button>
          {providers.isLoading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Loading providers…
            </p>
          )}
          {!providers.isLoading && !ready.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No provider is connected. Connect one in Settings → Agent.
            </p>
          )}
          {ready.length > 1 && (
            <div
              role="tablist"
              aria-label="Provider"
              className="flex flex-wrap gap-1 border-b border-border px-2 py-2"
            >
              {ready.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === shown}
                  onClick={() => {
                    setBrowsing(p.id);
                    setQuery("");
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    p.id === shown
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {label(p.id)}
                </button>
              ))}
            </div>
          )}
          {!!ready.length && (
            <>
              <div className="px-2 pt-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${label(shown)} models…`}
                    aria-label="Search models"
                    className="w-full rounded-lg border border-border bg-input/30 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-ring"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {models.isLoading && (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <LogoSpinner size={12} tone="mono" label="Loading" />
                    Loading models…
                  </p>
                )}
                {models.error && (
                  <p className="px-2 py-1.5 text-xs text-destructive">
                    {models.error.message}
                  </p>
                )}
                {!models.isLoading && !models.error && !filtered.length && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No matches.
                  </p>
                )}
                {filtered.map((m) => {
                  const selected =
                    value.provider === shown && value.model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pick({ provider: shown, model: m.id })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                        selected && "bg-primary/10",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">
                          {m.name}
                        </span>
                        {m.name !== m.id && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {m.id}
                          </span>
                        )}
                      </span>
                      {m.vision && (
                        <Eye
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-label="Accepts images"
                        />
                      )}
                      {selected && (
                        <Check className="size-4 shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
