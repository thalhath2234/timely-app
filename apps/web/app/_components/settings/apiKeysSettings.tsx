"use client";

import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/app/utils/hooks/apiKeys";
import { useDesktopInstance } from "@/app/utils/hooks/desktop";
import { API_BASE } from "@/app/utils/api/client";
import { mcpUrls } from "@/app/utils/mcpUrl";

const noopSubscribe = () => () => {};

function hermesSnippet(url: string, key: string) {
  return `mcp_servers:
  timely:
    url: "${url}"
    headers:
      Authorization: "Bearer ${key}"`;
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ApiKeysSettings() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [name, setName] = useState("Hermes");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState<"snippet" | "url" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { instance: desktop, loading: desktopLoading } = useDesktopInstance();
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");

  // Null until the address is known: on the server, and in the desktop app
  // until it reports the port its API runs on.
  const urls = useMemo(
    () => (origin && !desktopLoading ? mcpUrls({ desktop, apiBase: API_BASE, origin }) : null),
    [desktop, desktopLoading, origin],
  );

  const snippet = useMemo(
    () => hermesSnippet(urls?.local ?? "", revealed ?? "tk_..."),
    [urls, revealed],
  );

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCopied(null);
    try {
      const created = await createKey.mutateAsync(name.trim() || "Hermes");
      setRevealed(created.key);
      setName("Hermes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key.");
    }
  };

  const onCopy = async (what: "snippet" | "url") => {
    try {
      await navigator.clipboard.writeText(what === "url" ? (urls?.local ?? "") : snippet);
      setCopied(what);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const onRevoke = async (id: string) => {
    if (!window.confirm("Revoke this API key? Hermes will stop working until you create a new one.")) {
      return;
    }
    setError(null);
    try {
      await revokeKey.mutateAsync(id);
      if (revealed) setRevealed(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke key.");
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Integrations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Personal API keys let Hermes (and other MCP clients) read and edit your
          Timely data. The full key is shown only once.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">MCP server address</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-2 py-1.5 text-xs text-foreground">
            {urls?.local ?? "…"}
          </code>
          <button
            type="button"
            onClick={() => onCopy("url")}
            disabled={!urls}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-60"
          >
            <Copy className="size-3.5" />
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
        {desktop && (
          <p className="text-[11px] text-muted-foreground">
            Works while Timely is running on this computer.
          </p>
        )}
        {urls && urls.remote.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            From your other devices on Tailscale:{" "}
            {urls.remote.map((url, index) => (
              <span key={url}>
                {index > 0 && ", "}
                <code className="break-all">{url}</code>
              </span>
            ))}
          </p>
        )}
      </div>

      <form onSubmit={onCreate} className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Key name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Hermes"
            className="w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
          />
        </label>
        <button
          type="submit"
          disabled={createKey.isPending}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          <Plus className="size-4" />
          Create key
        </button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {revealed && (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">
            Copy this key now. You will not see it again.
          </p>
          <code className="mt-2 block break-all rounded-md bg-background px-2 py-1.5 text-xs text-foreground">
            {revealed}
          </code>
          <p className="mt-3 text-xs text-muted-foreground">
            Paste this into <code>~/.hermes/config.yaml</code>:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">
            {snippet}
          </pre>
          <button
            type="button"
            onClick={() => onCopy("snippet")}
            disabled={!urls}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            <Copy className="size-3.5" />
            {copied === "snippet" ? "Copied" : "Copy Hermes snippet"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Active keys</h3>
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading keys…</p>
        )}
        {!isLoading && (keys ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        )}
        {(keys ?? []).map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {key.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {key.prefix}… · created {formatWhen(key.createdAt)} · last used{" "}
                {formatWhen(key.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRevoke(key.id)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
