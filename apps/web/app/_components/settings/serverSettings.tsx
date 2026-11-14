"use client";

import { useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CircleAlert,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  MonitorSmartphone,
  RefreshCw,
  ScrollText,
  Server,
} from "lucide-react";
import {
  HOST_LIMIT_COPY,
  HOST_TOGGLE_LABEL,
  IDLE_MINUTES_LIMIT,
  WORKER_LIMIT,
  WORKING_FOLDER_HINT,
  WORKING_FOLDER_LABEL,
  agentLimitsError,
  hostAccountRows,
  hostSectionState,
  parseWholeNumber,
  type InstanceSettings,
} from "@timely/contract/instanceSettings";
import type { DesktopAction, DesktopInstance } from "@/electron-env";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import {
  getHealth,
  getInstance,
  getInstanceSettings,
  setAgentLimits,
  setHostAccount,
  setWorkingFolder,
} from "@/app/utils/api/instance";
import { useMe } from "@/app/utils/hooks/user";
import { Input } from "@/app/_components/_ui/field";
import {
  canToggleTailscale,
  describeSidecar,
  describeTailscale,
  describeHttps,
  describeUpdate,
  type StatusSummary,
} from "@/app/utils/desktopInstance";
import { useDesktopAction, useDesktopInstance, useDesktopSetting, useDesktopShell } from "@/app/utils/hooks/desktop";
import { Badge } from "@/app/_components/settings/agentSettings";
import PairingQr from "@/app/_components/settings/pairingQr";
import { buttonClass } from "@/app/_components/_ui/button";

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

const primaryButton = buttonClass();
const secondaryButton = buttonClass({ variant: "outline" });

export function StatusBadge({ summary }: { summary: StatusSummary }) {
  return <Badge tone={summary.tone}>{summary.label}</Badge>;
}

function StatusCard({
  icon: Icon,
  title,
  summary,
  rows,
}: {
  icon: typeof Database;
  title: string;
  summary: StatusSummary;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <StatusBadge summary={summary} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 truncate text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      {summary.detail && (
        <p className={cn("text-xs", summary.tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
          {summary.detail}
        </p>
      )}
    </div>
  );
}

export function Toggle({
  name,
  label,
  description,
  checked,
  disabled,
  hint,
  busy,
  onChange,
}: {
  /** Form name of the switch, also used as a stable test hook. */
  name: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  busy?: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="min-w-0">
        <span id={`${id}-label`} className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </p>
        {hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {hint}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <LogoSpinner size={14} label="Saving" />}
        {/* The input is visually hidden; the label wraps the drawn track so a
            click anywhere on the switch toggles it. */}
        <label
          className={cn(
            "relative inline-flex items-center",
            disabled || busy ? "cursor-not-allowed" : "cursor-pointer",
          )}
          data-toggle={name}
        >
          <input
            id={id}
            name={name}
            type="checkbox"
            role="switch"
            aria-checked={checked}
            aria-labelledby={`${id}-label`}
            aria-describedby={hint ? `${id}-desc ${id}-hint` : `${id}-desc`}
            className="peer sr-only"
            checked={checked}
            disabled={disabled || busy}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className="relative block h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-4"
          >
            <span className="absolute left-0.5 top-0.5 block size-4 rounded-full bg-background shadow transition-transform" />
          </span>
        </label>
      </div>
    </div>
  );
}

function ActionButton({
  action,
  icon: Icon,
  label,
  primary,
  run,
  pending,
}: {
  action: DesktopAction;
  icon: typeof Download;
  label: string;
  primary?: boolean;
  run: (name: DesktopAction) => Promise<unknown>;
  pending: DesktopAction | null | undefined;
}) {
  const busy = pending === action;
  return (
    <button
      type="button"
      onClick={() => void run(action).catch(() => undefined)}
      disabled={pending != null}
      className={primary ? primaryButton : secondaryButton}
      aria-label={label}
    >
      {busy ? (
        <LogoSpinner size={14} tone={primary ? "mono" : "brand"} label="Working" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {label}
    </button>
  );
}

export function TailscaleInstallLink({ className }: { className?: string }) {
  return (
    <a
      href={TAILSCALE_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(primaryButton, className)}
    >
      <ExternalLink className="size-3.5" /> Install Tailscale
    </a>
  );
}

/** Addresses, Tailscale state and the install link, shared with the wizard. */
export function AddressList({ instance }: { instance: DesktopInstance }) {
  const tailscale = describeTailscale(instance.tailscale, instance.settings.tailscaleEnabled);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <span className="text-muted-foreground">On this computer</span>
        <code className="font-mono text-foreground">{instance.api.localUrl}</code>
        <span className="text-muted-foreground">Over Tailscale</span>
        <span className="min-w-0">
          {instance.api.tailscaleUrls.length > 0 ? (
            <span className="flex flex-col gap-0.5">
              {instance.api.tailscaleUrls.map((url) => (
                <code key={url} className="font-mono text-foreground">
                  {url}
                </code>
              ))}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <StatusBadge summary={tailscale} />
            </span>
          )}
        </span>
      </div>
      {!instance.tailscale.installed && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Tailscale is a free app that links your devices into a private network, so your phone
            can reach this computer from anywhere without opening anything to the internet.
            Install it on this computer and on your phone, sign in with the same account on both,
            then come back here.
          </p>
          <TailscaleInstallLink className="self-start" />
        </div>
      )}
      {instance.tailscale.installed && !instance.tailscale.running && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Tailscale is installed but not connected. Open Tailscale and sign in, then this address
          will appear here.
        </p>
      )}
      {instance.tailscale.installed && instance.tailscale.running && tailscale.detail && (
        <p className="text-xs text-muted-foreground">{tailscale.detail}</p>
      )}
    </div>
  );
}

function ApiReachability() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false, refetchInterval: 15000 });
  const details = useQuery({ queryKey: ["instance"], queryFn: getInstance, retry: false, refetchInterval: 15000 });
  const error = health.error ?? details.error;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Connection check</h3>
        </div>
        {health.isPending || details.isPending ? (
          <LogoSpinner size={14} label="Checking" />
        ) : error ? (
          <Badge tone="danger">Not reachable</Badge>
        ) : health.data?.status === "degraded" ? (
          <Badge tone="warn">Database problem</Badge>
        ) : (
          <Badge tone="ok">Reachable</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        This asks the server, the same way your phone will, whether it is answering.
      </p>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <CircleAlert className="size-3.5 shrink-0" />
          The server did not answer: {error instanceof Error ? error.message : "unknown error"}. If
          it is starting, this clears in a few seconds. Otherwise try “Restart server”.
        </p>
      )}
      {health.data?.status === "degraded" && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The server is up but cannot reach its database: {health.data.db}
        </p>
      )}
      {details.data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Listening on</dt>
          <dd className="min-w-0 text-foreground" data-testid="instance-listening">
            {details.data.listening.length > 0 ? details.data.listening.join(", ") : "—"}
          </dd>
          <dt className="text-muted-foreground">New accounts</dt>
          <dd className="text-foreground">
            {details.data.registrationOpen ? "Allowed" : "Turned off"}
          </dd>
          <dt className="text-muted-foreground">Server version</dt>
          <dd className="text-foreground">{details.data.version}</dd>
          <dt className="text-muted-foreground">Running since</dt>
          <dd className="text-foreground">{new Date(details.data.startedAt).toLocaleString()}</dd>
        </dl>
      )}
    </section>
  );
}

const SETTINGS_KEY = ["instance-settings"] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not save that.";
}

/**
 * "Let the assistant use this computer": which accounts may run approved
 * commands here, the signed-in account's working folder, and how many agent
 * workers run at once. Only the desktop window changes these (the server
 * answers 404 to anyone else); everywhere else the section reads the same
 * facts and says where to change them.
 */
export function HostToolsSection() {
  const shell = useDesktopShell();
  const queryClient = useQueryClient();
  const me = useMe();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getInstanceSettings, retry: false, refetchInterval: 15000 });
  const [error, setError] = useState<string | null>(null);
  const uid = me.data?.id ?? null;
  const data = settings.data;

  const save = useMutation({
    mutationFn: async (run: () => Promise<InstanceSettings>) => run(),
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(SETTINGS_KEY, next);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (settings.isPending) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-busy="true">
        <HostHeading />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LogoSpinner size={14} label="Loading" /> Reading what this account may do…
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <HostHeading />
        <p className="text-xs text-destructive" role="alert">
          {errorMessage(settings.error)}
        </p>
      </section>
    );
  }

  const mine = data.hostAccounts.find((account) => account.uid === uid);
  const state = hostSectionState(data, Boolean(shell && data.shell), mine?.source ?? null);
  const rows = hostAccountRows(data, uid);
  const busy = save.isPending;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="host-tools-heading">
      <h3 id="host-tools-heading" className="text-sm font-semibold text-foreground">
        Assistant on this computer
      </h3>
      <Toggle
        name="hostAllowed"
        label={HOST_TOGGLE_LABEL}
        description={HOST_LIMIT_COPY}
        checked={state.checked}
        disabled={!state.editable || !state.canTurnOff || !uid}
        hint={state.note || undefined}
        busy={busy}
        onChange={(next) => uid && save.mutate(() => setHostAccount(uid, next))}
      />

      {data.hostAccounts.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <h4 className="text-sm font-medium text-foreground">Accounts that can use this computer</h4>
          <ul className="flex flex-col divide-y divide-border" data-testid="host-accounts">
            {rows.map((row) => (
              <li key={row.uid} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {row.title}
                    {row.you && <span className="ml-1.5 text-xs text-muted-foreground">({row.you})</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={row.folder}>
                    {row.folder}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <Badge tone={row.source === "server" ? "muted" : "primary"}>{row.sourceLabel}</Badge>
                  {/* The owner at this computer can take another account's access
                      away without signing in as it; an account the server names
                      is changed in the server's settings. */}
                  {state.editable && row.source === "desktop" && !row.you && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Turn off ${row.title}`}
                      onClick={() => save.mutate(() => setHostAccount(row.uid, false))}
                      className="cursor-pointer text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                    >
                      Turn off
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!data.shell && data.otherHostAccounts > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="host-other-accounts">
              {data.otherHostAccounts === 1
                ? "1 other account can use this computer."
                : `${data.otherHostAccounts} other accounts can use this computer.`}{" "}
              Their names and folders show in the desktop app.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Each account is turned on separately: sign in as it in the desktop app to turn it on, or ask whoever runs this server to add
            it (TIMELY_AGENT_HOST_ACCOUNTS).{state.editable ? " Turn another account off here." : ""} Every other account can still chat
            with the assistant, but gets no commands, files or browser.
          </p>
        </div>
      )}

      {state.checked && (
        <WorkingFolderRow
          folder={data.thisAccountWorkingDir}
          editable={state.editable}
          busy={busy}
          onPick={async () => {
            if (!shell || !uid) return;
            const picked = await shell.pickFolder();
            if (!picked.canceled) save.mutate(() => setWorkingFolder(uid, picked.path));
          }}
          onClear={() => uid && save.mutate(() => setWorkingFolder(uid, ""))}
        />
      )}

      <LimitsRow data={data} editable={state.editable} busy={busy} onSave={(max, idle) => save.mutate(() => setAgentLimits({ maxWorkers: max, idleMinutes: idle }))} />

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <CircleAlert className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}

function HostHeading() {
  return (
    <div className="flex items-center gap-2">
      <Cpu className="size-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">Assistant on this computer</h3>
    </div>
  );
}

function WorkingFolderRow({
  folder,
  editable,
  busy,
  onPick,
  onClear,
}: {
  folder: string;
  editable: boolean;
  busy: boolean;
  onPick: () => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">{WORKING_FOLDER_LABEL}</h4>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={folder || undefined} data-testid="working-folder">
            {folder || "Not chosen. The assistant works in its own folder."}
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void onPick()}>
              <FolderOpen className="size-3.5" /> {folder ? "Change folder" : "Choose folder"}
            </button>
            {folder && (
              <button type="button" className={buttonClass({ variant: "ghost" })} disabled={busy} onClick={onClear}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{WORKING_FOLDER_HINT}</p>
    </div>
  );
}

function LimitsRow({
  data,
  editable,
  busy,
  onSave,
}: {
  data: InstanceSettings;
  editable: boolean;
  busy: boolean;
  onSave: (maxWorkers: number, idleMinutes: number) => void;
}) {
  const [workers, setWorkers] = useState<string | null>(null);
  const [idle, setIdle] = useState<string | null>(null);
  const workersText = workers ?? String(data.maxWorkers);
  const idleText = idle ?? String(data.idleMinutes);
  const problem = agentLimitsError(parseWholeNumber(workersText), parseWholeNumber(idleText));
  const dirty = workersText !== String(data.maxWorkers) || idleText !== String(data.idleMinutes);
  const workersId = useId();
  const idleId = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">Assistant workers</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Each chat the assistant is working on, or that waits on a live card, uses one worker. A worker that has
          done nothing for a while stops, and starts again when it is needed.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={workersId} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Workers at once ({WORKER_LIMIT.min} to {WORKER_LIMIT.max})
          <Input id={workersId} inputMode="numeric" value={workersText} disabled={!editable || busy} onChange={(e) => setWorkers(e.target.value)} aria-invalid={dirty && problem !== null} />
        </label>
        <label htmlFor={idleId} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Minutes before an idle worker stops ({IDLE_MINUTES_LIMIT.min} to {IDLE_MINUTES_LIMIT.max})
          <Input id={idleId} inputMode="numeric" value={idleText} disabled={!editable || busy} onChange={(e) => setIdle(e.target.value)} aria-invalid={dirty && problem !== null} />
        </label>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !dirty || problem !== null}
            onClick={() => {
              onSave(parseWholeNumber(workersText), parseWholeNumber(idleText));
              setWorkers(null);
              setIdle(null);
            }}
          >
            Save
          </button>
          {dirty && problem && (
            <p className="text-xs text-destructive" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ServerSettings() {
  const { instance, loading, error } = useDesktopInstance();
  const actions = useDesktopAction();
  const setting = useDesktopSetting();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LogoSpinner size={16} label="Loading" /> Reading server status…
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">Server</h2>
        <p className="text-sm text-muted-foreground">
          {error
            ? `Could not read the server status: ${error}`
            : "This page is only available in the Timely desktop app, which runs its own server."}
        </p>
        <HostToolsSection />
      </div>
    );
  }

  const api = describeSidecar(instance.api);
  const postgres = describeSidecar(instance.postgres);
  const web = describeSidecar(instance.web);
  const update = describeUpdate(instance.update);
  const tailscaleReady = canToggleTailscale(instance);
  const https = describeHttps(instance);
  const actionResult = actions.result;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h2 className="text-base font-semibold text-foreground">Server</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Timely runs its own server and database on this computer. Pair your phone here, and keep
          an eye on whether everything is running.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Status</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusCard
            icon={Database}
            title="Database"
            summary={postgres}
            rows={[
              { label: "Version", value: instance.postgres.version ?? "PostgreSQL" },
              { label: "Port", value: instance.postgres.port },
            ]}
          />
          <StatusCard
            icon={Server}
            title="Server"
            summary={api}
            rows={[
              { label: "Port", value: instance.api.port },
              { label: "Restarts", value: instance.api.restarts },
              ...(instance.api.lastError ? [{ label: "Last error", value: instance.api.lastError }] : []),
            ]}
          />
          <StatusCard
            icon={MonitorSmartphone}
            title="App"
            summary={web}
            rows={[
              { label: "Version", value: instance.version },
              { label: "Port", value: instance.web.port },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Data folder:</span>
          <code className="min-w-0 truncate font-mono text-foreground" title={instance.dataDir}>
            {instance.dataDir}
          </code>
          <ActionButton
            action="openDataFolder"
            icon={FolderOpen}
            label="Open data folder"
            run={actions.run}
            pending={actions.pending}
          />
        </div>
      </section>

      <ApiReachability />

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Addresses</h3>
        <AddressList instance={instance} />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Pair your phone</h3>
        <p className="text-xs text-muted-foreground">
          Install Timely on your phone and scan this code. To reach this computer from anywhere,
          the phone also needs the Tailscale app, signed in with the same account as this computer.
        </p>
        <PairingQr instance={instance} />
      </section>

      <HostToolsSection />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Access</h3>
        <Toggle
          name="tailscaleEnabled"
          label="Tailscale access"
          description="Lets your phone and other devices on your Tailscale network reach Timely. Nothing is opened to the internet. Turning this on or off restarts the server for a few seconds."
          checked={instance.settings.tailscaleEnabled}
          disabled={!tailscaleReady}
          hint={!tailscaleReady ? "Install Tailscale on this computer to turn this on." : undefined}
          busy={setting.pending === "tailscaleEnabled"}
          onChange={(next) => void setting.set("tailscaleEnabled", next).catch(() => undefined)}
        />
        {instance.settings.tailscaleEnabled && (
          <div className="flex flex-col gap-1.5">
            <Toggle
              name="tailscaleHttps"
              label="HTTPS with Tailscale Serve"
              description={`Serves Timely at https://${instance.tailscale.dnsName ?? "<this computer>.ts.net"} with a real certificate, using \`tailscale serve\` on port 443. Needs MagicDNS and HTTPS certificates turned on for your tailnet.`}
              checked={instance.settings.tailscaleHttps}
              disabled={!instance.tailscale.running}
              hint={!instance.tailscale.running ? "Connect Tailscale on this computer first." : undefined}
              busy={setting.pending === "tailscaleHttps" || (instance.settings.tailscaleHttps && instance.tailscale.https.status === "starting")}
              onChange={(next) => void setting.set("tailscaleHttps", next).catch(() => undefined)}
            />
            {instance.settings.tailscaleHttps && https.tone !== "muted" && (
              <div className="flex flex-wrap items-center gap-2 px-1 text-xs" data-testid="https-status">
                <StatusBadge summary={https} />
                {https.detail && (
                  <span className={https.tone === "danger" ? "text-destructive" : "text-muted-foreground"}>
                    {https.detail}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <Toggle
          name="allowRegistration"
          label="Allow new accounts"
          description="Lets someone create a new account on this server. Turn it off once everyone who needs an account has one. Changing this restarts the server for a few seconds."
          checked={instance.settings.allowRegistration}
          busy={setting.pending === "allowRegistration"}
          onChange={(next) => void setting.set("allowRegistration", next).catch(() => undefined)}
        />
        {setting.error && (
          <p className="text-xs text-destructive" role="alert">
            {setting.error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Maintenance</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton action="backupNow" icon={Archive} label="Back up now" run={actions.run} pending={actions.pending} />
          <ActionButton action="openDataFolder" icon={FolderOpen} label="Open data folder" run={actions.run} pending={actions.pending} />
          <ActionButton action="openLogs" icon={ScrollText} label="Open logs" run={actions.run} pending={actions.pending} />
          <ActionButton action="restartApi" icon={RefreshCw} label="Restart server" run={actions.run} pending={actions.pending} />
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Updates</span>
              <StatusBadge summary={update} />
            </div>
            <div className="flex items-center gap-2">
              {instance.update.status !== "managed" && (
                <ActionButton
                  action="checkForUpdates"
                  icon={RefreshCw}
                  label="Check for updates"
                  run={actions.run}
                  pending={actions.pending}
                />
              )}
              {instance.update.status === "ready" && (
                <ActionButton
                  action="installUpdate"
                  icon={Download}
                  label="Install and restart"
                  primary
                  run={actions.run}
                  pending={actions.pending}
                />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Installed version {instance.version}
            {instance.update.version && instance.update.status !== "upToDate"
              ? ` · update ${instance.update.version}`
              : ""}
            . Before any update, Timely backs up the database first.
          </p>
          {instance.update.status === "managed" && (
            <p className="text-xs text-muted-foreground">
              This copy was installed by your package manager (for example the AUR package), so update it there. If
              Timely was open during the update, it restarts into the new version the next time you open it.
            </p>
          )}
          {update.detail && <p className="text-xs text-destructive">{update.detail}</p>}
        </div>
        <p
          role="status"
          aria-live="polite"
          className={cn("min-h-4 text-xs", actionResult && !actionResult.ok ? "text-destructive" : "text-success")}
          data-testid="action-result"
        >
          {actionResult
            ? actionResult.ok
              ? (actionResult.message ?? "Done.")
              : actionResult.error
            : ""}
        </p>
      </section>
    </div>
  );
}
