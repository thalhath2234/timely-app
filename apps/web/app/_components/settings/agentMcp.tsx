"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Plug, Search } from "lucide-react";
import {
  ADD_COMMAND_NOTE,
  COMMAND_NOT_ALLOWED,
  MCP_INTRO,
  MCP_MODES,
  MCP_SENDING_NOTE,
  MCP_TITLE,
  SIGN_IN_NOTE,
  addedMessage,
  catalogCategories,
  filterCatalog,
  missingFields,
  modeHint,
  nameProblem,
  parseArgs,
  parseEnv,
  serverStatus,
  serverTarget,
  suggestName,
  toolAlwaysAsks,
  toolClassLabel,
  urlProblem,
  type McpCatalogRow,
  type McpMode,
  type McpServer,
} from "@timely/contract/agentMcp";
import Button from "@/app/_components/_ui/button";
import { Field, Input, Textarea } from "@/app/_components/_ui/field";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import Select from "@/app/_components/_ui/select";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import { ErrorRow, Tag, errorText } from "./learnedShared";
import {
  useAddMcpServer,
  useMcpCatalog,
  useMcpServers,
  useMcpSignIn,
  useMcpTools,
  useRemoveMcpServer,
  useUpdateMcpServer,
} from "./agentMcpHooks";

/** How long a sign-in is watched for after its page opened (the server's own window is 15 minutes). */
const SIGN_IN_WATCH_MS = 3 * 60_000;

/**
 * Settings → Agent → MCP servers (phase 5, Q-5.6): the services the assistant
 * may use beyond Timely, the whole curated catalog included, each server Can use,
 * Ask me first or Off. A new server starts on Ask me first. Sending and spending
 * tools always ask in Auto, whatever the mode.
 */
export default function McpServersGroup() {
  const [watching, setWatching] = useState<string | null>(null);
  const servers = useMcpServers(watching);
  const [adding, setAdding] = useState(false);
  const list = servers.data?.servers ?? [];

  // A sign-in nobody finished stops being watched; one that finished stops the polling by itself.
  useEffect(() => {
    if (!watching) return;
    const timer = window.setTimeout(() => setWatching(null), SIGN_IN_WATCH_MS);
    return () => window.clearTimeout(timer);
  }, [watching]);

  return (
    <section data-testid="mcp-servers" aria-label={MCP_TITLE}>
      <GroupLabel aside={list.length > 0 ? `${list.length}` : undefined}>{MCP_TITLE}</GroupLabel>
      <ListGroup>
        {servers.isPending ? (
          <p className="px-3.5 py-2.5 text-[13px] text-muted-foreground">Checking…</p>
        ) : servers.error ? (
          <ErrorRow error={servers.error} what="MCP servers" onRetry={() => void servers.refetch()} retrying={servers.isFetching} />
        ) : (
          list.map((server) => (
            <ServerEntry key={server.name} server={server} waiting={watching === server.name && !server.signedIn} onSignInStarted={() => setWatching(server.name)} />
          ))
        )}
        {servers.data ? (
          <ListRow tone="add" label={adding ? "Close" : "Add a server"} onClick={() => setAdding((v) => !v)} />
        ) : null}
      </ListGroup>
      {servers.data && list.length === 0 && !adding ? <GroupHint>{MCP_INTRO}</GroupHint> : null}
      {adding && servers.data ? (
        <AddPanel
          canAddCommand={servers.data.canAddCommand}
          added={new Set(list.map((s) => s.name))}
          onDone={() => setAdding(false)}
          onSignIn={(name) => setWatching(name)}
        />
      ) : null}
      {list.length > 0 ? <GroupHint>{MCP_SENDING_NOTE}</GroupHint> : null}
    </section>
  );
}

function ServerEntry({ server, waiting, onSignInStarted }: { server: McpServer; waiting: boolean; onSignInStarted: () => void }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateMcpServer();
  const signIn = useMcpSignIn();
  const status = serverStatus(server);
  const needsSignIn = server.status === "needs_sign_in" && server.mode !== "off";

  async function startSignIn() {
    try {
      const url = await signIn.mutateAsync(server.name);
      window.open(url, "_blank", "noopener,noreferrer");
      onSignInStarted();
    } catch (err) {
      useToastStore.getState().show(errorText(err, "Couldn't start the sign-in."));
    }
  }

  return (
    <div data-testid={`mcp-server-${server.name}`}>
      <ListRow
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{server.name}</span>
            {server.flag ? (
              <span className="hidden sm:inline-flex">
                <Tag tone="warning">{server.flag}</Tag>
              </span>
            ) : null}
          </span>
        }
        meta={
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{serverTarget(server)}</span>
            {server.flag ? <span className="truncate text-warning-text sm:hidden">{server.flag}</span> : null}
            <span
              className={cn(
                "truncate",
                status.tone === "error" && "text-destructive",
                status.tone === "warn" && "text-warning-text",
              )}
            >
              {waiting ? "Waiting for the sign-in…" : status.text}
            </span>
          </span>
        }
      >
        {needsSignIn ? (
          <Button size="sm" variant="soft" loading={signIn.isPending} onClick={() => void startSignIn()}>
            Sign in
          </Button>
        ) : null}
        <Select
          variant="row"
          aria-label={`${server.name} mode`}
          value={server.mode}
          disabled={update.isPending}
          options={MCP_MODES.map((m) => ({ value: m.value, label: m.label }))}
          onChange={(value) =>
            update.mutate(
              { name: server.name, patch: { mode: value as McpMode } },
              { onError: (err) => useToastStore.getState().show(errorText(err, "Couldn't change the mode.")) },
            )
          }
        />
        <button
          type="button"
          aria-label={`${open ? "Hide" : "Show"} details for ${server.name}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </ListRow>
      {open ? <ServerDetails server={server} onSignIn={() => void startSignIn()} signingIn={signIn.isPending} /> : null}
    </div>
  );
}

function ServerDetails({ server, onSignIn, signingIn }: { server: McpServer; onSignIn: () => void; signingIn: boolean }) {
  const tools = useMcpTools(server.name, server.mode !== "off" && server.status !== "unavailable" && server.status !== "waiting_for_ok");
  const remove = useRemoveMcpServer();
  const onRemove = () =>
    requestConfirm({
      title: `Remove ${server.name}?`,
      description: "The assistant can no longer use it, and its saved sign-in is deleted. Your account on that service is untouched.",
      confirmLabel: "Remove",
      pendingLabel: "Removing…",
      onConfirm: async () => {
        try {
          await remove.mutateAsync(server.name);
        } catch (err) {
          useToastStore.getState().show(errorText(err, "Couldn't remove it."));
        }
      },
    });
  const list = tools.data?.tools ?? server.tools ?? [];
  return (
    <div className="flex flex-col gap-2.5 border-t border-border bg-muted/30 px-3.5 py-3" data-testid="mcp-details">
      {server.description ? <p className="text-xs text-muted-foreground">{server.description}</p> : null}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{MCP_MODES.find((m) => m.value === server.mode)?.label}.</span> {modeHint(server.mode)}
      </p>
      {server.flag ? <p className="text-xs text-warning-text">{server.flag}. Its sending tools always ask in Auto.</p> : null}
      {server.warning ? <p className="text-xs text-destructive">{server.warning}</p> : null}
      <div>
        <h4 className="mb-1 text-xs font-semibold text-foreground">Tools</h4>
        {tools.isFetching && list.length === 0 ? (
          <p className="text-xs text-muted-foreground">Asking the server…</p>
        ) : tools.error ? (
          <p className="text-xs text-destructive">{errorText(tools.error, "Couldn't list the tools.")}</p>
        ) : tools.data?.error ? (
          <p className="text-xs text-muted-foreground">
            {tools.data.needsSignIn ? "Sign in to see this server's tools." : tools.data.error}
          </p>
        ) : list.length === 0 ? (
          <p className="text-xs text-muted-foreground">{server.mode === "off" ? "Turn it on to see its tools." : "No tools listed."}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label={`${server.name} tools`}>
            {list.map((tool) => (
              <li key={tool.name} className="flex min-w-0 items-start gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{tool.name}</span>
                  {tool.description ? <span className="line-clamp-2 text-muted-foreground">{tool.description}</span> : null}
                </span>
                <Tag tone={toolAlwaysAsks(tool.class) ? "warning" : "muted"}>{toolClassLabel(tool.class)}</Tag>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {server.signsIn && server.mode !== "off" ? (
          <Button size="sm" variant="outline" loading={signingIn} onClick={onSignIn}>
            {server.signedIn ? "Sign in again" : "Sign in"}
          </Button>
        ) : null}
        <Button size="sm" variant="destructive-ghost" onClick={onRemove} disabled={remove.isPending}>
          Remove
        </Button>
        {server.signsIn ? <span className="text-xs text-muted-foreground">{SIGN_IN_NOTE}</span> : null}
      </div>
    </div>
  );
}

type AddKind = "catalog" | "address" | "command";

function AddPanel({
  canAddCommand,
  added,
  onDone,
  onSignIn,
}: {
  canAddCommand: boolean;
  added: Set<string>;
  onDone: () => void;
  onSignIn: (name: string) => void;
}) {
  const [kind, setKind] = useState<AddKind>("catalog");
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[12px] border border-border bg-card p-3.5" data-testid="mcp-add">
      <SegmentedControl<AddKind>
        aria-label="How to add a server"
        value={kind}
        onChange={setKind}
        options={[
          { value: "catalog", label: "Catalog" },
          { value: "address", label: "An address" },
          { value: "command", label: "A command" },
        ]}
      />
      {kind === "catalog" ? <CatalogPicker onDone={onDone} onSignIn={onSignIn} /> : null}
      {kind === "address" ? <AddressForm added={added} onDone={onDone} onSignIn={onSignIn} /> : null}
      {kind === "command" ? (
        canAddCommand ? (
          <CommandForm added={added} onDone={onDone} />
        ) : (
          <p className="text-xs text-muted-foreground">{COMMAND_NOT_ALLOWED}</p>
        )
      ) : null}
    </div>
  );
}

function CatalogPicker({ onDone, onSignIn }: { onDone: () => void; onSignIn: (name: string) => void }) {
  const catalog = useMcpCatalog(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = catalog.data ?? [];
  const shown = filterCatalog(rows, query, category);
  const visible = showAll || query || category ? shown : shown.slice(0, 12);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search the catalog" className="pl-8" placeholder="Search servers" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select
          aria-label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "", label: "All categories" }, ...catalogCategories(rows)]}
        />
      </div>
      {catalog.isPending ? (
        <p className="text-xs text-muted-foreground">Asking the assistant for the catalog…</p>
      ) : catalog.error ? (
        <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <span className="min-w-0 flex-1">{errorText(catalog.error, "Couldn't load the catalog.")}</span>
          <Button size="sm" variant="ghost" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing in the catalog matches.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border" aria-label="Catalog">
          {visible.map((row) => (
            <CatalogEntry
              key={row.id}
              row={row}
              open={picked === row.id}
              onOpen={() => setPicked(picked === row.id ? null : row.id)}
              onDone={onDone}
              onSignIn={onSignIn}
            />
          ))}
        </ul>
      )}
      {!showAll && !query && !category && shown.length > visible.length ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowAll(true)}>
          Show all {shown.length}
        </Button>
      ) : null}
    </div>
  );
}

function CatalogEntry({
  row,
  open,
  onOpen,
  onDone,
  onSignIn,
}: {
  row: McpCatalogRow;
  open: boolean;
  onOpen: () => void;
  onDone: () => void;
  onSignIn: (name: string) => void;
}) {
  const add = useAddMcpServer();
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = missingFields(row, values);
  const needsValues = row.fields.length > 0;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (missing.length > 0 || add.isPending) return;
    try {
      const out = await add.mutateAsync({ catalogId: row.id, values });
      useToastStore.getState().show(addedMessage(out.server.name, out.pending));
      if (out.server.status === "needs_sign_in") onSignIn(out.server.name);
      onDone();
    } catch (err) {
      useToastStore.getState().show(errorText(err, "Couldn't add the server."));
    }
  }

  return (
    <li className="py-2.5" data-testid={`mcp-catalog-${row.id}`}>
      <div className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{row.name}</span>
            {row.flag ? <Tag tone="warning">{row.flag}</Tag> : null}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{row.description}</span>
        </span>
        {row.added ? (
          <Tag>Added</Tag>
        ) : needsValues ? (
          <Button size="sm" variant="outline" aria-expanded={open} onClick={onOpen}>
            Set up
          </Button>
        ) : (
          <Button size="sm" variant="outline" loading={add.isPending} onClick={() => void submit()}>
            Add
          </Button>
        )}
      </div>
      {open && needsValues && !row.added ? (
        <form onSubmit={submit} className="mt-2.5 flex flex-col gap-2.5">
          {row.note ? <p className="text-xs text-muted-foreground">{row.note}</p> : null}
          {row.fields.map((f) => (
            <Field key={f.name} label={f.prompt}>
              {(id) => (
                <Input
                  id={id}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={add.isPending} disabled={missing.length > 0}>
              Add {row.name}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpen}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function FormShell({ children, onSubmit, busy, label, disabled }: { children: ReactNode; onSubmit: () => void; busy: boolean; label: string; disabled?: boolean }) {
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div>
        <Button type="submit" size="sm" loading={busy} disabled={disabled}>
          {label}
        </Button>
      </div>
    </form>
  );
}

function AddressForm({ added, onDone, onSignIn }: { added: Set<string>; onDone: () => void; onSignIn: (name: string) => void }) {
  const add = useAddMcpServer();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [touched, setTouched] = useState(false);
  const shownName = touched ? name : suggestName(url);
  const problem = url ? urlProblem(url) : null;
  const nameIssue = shownName ? (added.has(shownName) ? "You already have a server with that name" : nameProblem(shownName)) : null;
  const ready = Boolean(url) && !problem && Boolean(shownName) && !nameIssue;

  async function submit() {
    try {
      const out = await add.mutateAsync({ name: shownName, url: url.trim(), signIn });
      useToastStore.getState().show(addedMessage(out.server.name, out.pending));
      if (signIn) onSignIn(out.server.name);
      onDone();
    } catch (err) {
      useToastStore.getState().show(errorText(err, "Couldn't add the server."));
    }
  }
  return (
    <FormShell onSubmit={() => void submit()} busy={add.isPending} label="Add server" disabled={!ready}>
      <Field label="Address" error={problem} hint="The server's MCP address. It has to be on the public internet.">
        {(id) => <Input id={id} inputMode="url" autoComplete="off" placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      <Field label="Name" error={nameIssue}>
        {(id) => (
          <Input
            id={id}
            autoComplete="off"
            value={shownName}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
          />
        )}
      </Field>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="mt-0.5" checked={signIn} onChange={(e) => setSignIn(e.target.checked)} />
        <span>
          <span className="font-medium text-foreground">This server asks me to sign in.</span> Needs an https address. {SIGN_IN_NOTE}
        </span>
      </label>
    </FormShell>
  );
}

function CommandForm({ added, onDone }: { added: Set<string>; onDone: () => void }) {
  const add = useAddMcpServer();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const env = parseEnv(envText);
  const nameIssue = name ? (added.has(name) ? "You already have a server with that name" : nameProblem(name)) : null;
  const ready = Boolean(name) && !nameIssue && Boolean(command.trim()) && !env.error;

  async function submit() {
    try {
      const out = await add.mutateAsync({ name, command: command.trim(), args: parseArgs(args), env: env.env });
      useToastStore.getState().show(addedMessage(out.server.name, out.pending));
      onDone();
    } catch (err) {
      useToastStore.getState().show(errorText(err, "Couldn't add the server."));
    }
  }
  return (
    <FormShell onSubmit={() => void submit()} busy={add.isPending} label="Add and ask me" disabled={!ready}>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Plug aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {ADD_COMMAND_NOTE}
      </p>
      <Field label="Name" error={nameIssue}>
        {(id) => <Input id={id} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Command">
        {(id) => <Input id={id} autoComplete="off" placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} />}
      </Field>
      <Field label="Arguments" hint="Separated by spaces. Use quotes around one that has spaces.">
        {(id) => <Input id={id} autoComplete="off" placeholder="-y @scope/some-mcp-server" value={args} onChange={(e) => setArgs(e.target.value)} />}
      </Field>
      <Field label="Environment" error={env.error} hint="One NAME=value per line. The values are kept encrypted and the card shows only the names.">
        {(id) => <Textarea id={id} rows={3} autoComplete="off" spellCheck={false} value={envText} onChange={(e) => setEnvText(e.target.value)} />}
      </Field>
    </FormShell>
  );
}
