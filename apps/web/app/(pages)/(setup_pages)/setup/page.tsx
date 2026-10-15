"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  ScanSearch,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { fadeTransition } from "@/app/_components/_ui/motion";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import AuthShell, { NowBlock } from "@/app/_components/auth/authShell";
import DayPanel, { type DayBlock } from "@/app/_components/auth/dayPanel";
import { describeTailscale } from "@/app/utils/desktopInstance";
import {
  useDesktopInstance,
  useDesktopSetting,
} from "@/app/utils/hooks/desktop";
import {
  useAgentProviders,
  useRescanProviders,
  useSetOpenRouterKey,
} from "@/app/utils/hooks/agentProviders";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type CliProviderView,
} from "@/app/utils/api/agentProviders";
import {
  Badge,
  CLI_INSTALL_URLS,
  MoreApiKeys,
} from "@/app/_components/settings/agentSettings";
import { AuthField } from "@/app/_components/auth/fields";
import {
  AddressList,
  StatusBadge,
  Toggle,
} from "@/app/_components/settings/serverSettings";
import PairingQr from "@/app/_components/settings/pairingQr";

const secondaryButton = buttonClass({ variant: "outline", size: "lg" });

const STEPS = [
  {
    id: "tailscale",
    title: "Reach Timely from anywhere",
    color: "var(--lp-cyan)",
  },
  {
    id: "openrouter",
    title: "Choose how the assistant thinks",
    color: "var(--lp-pink)",
  },
  { id: "cli", title: "Use Claude Code or Codex", color: "var(--lp-violet)" },
  { id: "pair", title: "Pair your phone", color: "var(--lp-amber)" },
] as const;

/** The setup steps as blocks on today: done ones behind the now marker, the current one at it. */
function setupDay(step: number): DayBlock[] {
  const blocks: DayBlock[] = STEPS.map((item, index) => ({
    id: item.id,
    title: item.title,
    at: (index - step) * 30,
    length: 25,
    color: item.color,
    exact: true,
    done: index < step,
    state: index === step ? "now" : undefined,
  }));
  blocks.push({
    id: "calendar",
    title: "Start planning",
    at: (STEPS.length - step) * 30,
    length: 45,
    color: "var(--lp-green)",
    exact: true,
  });
  return blocks;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function CliRow({
  id,
  view,
}: {
  id: "claude" | "codex";
  view: CliProviderView;
}) {
  const status = view.status;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">
          {PROVIDER_LABELS[id]}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {status.found ? (
            <Badge tone="ok">
              <TerminalSquare className="size-3" /> Found
              {status.version ? ` · ${status.version}` : ""}
            </Badge>
          ) : (
            <Badge tone="warn">
              <CircleAlert className="size-3" /> Not found on this computer
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
        </div>
      </div>
      {!status.found && (
        <a
          href={CLI_INSTALL_URLS[id]}
          target="_blank"
          rel="noreferrer"
          className={secondaryButton}
        >
          <ExternalLink className="size-3.5" /> Install {PROVIDER_LABELS[id]}
        </a>
      )}
    </div>
  );
}

/** The OpenRouter key, saved right here so adding one never leaves setup. */
function OpenRouterKeyForm({ data }: { data: AgentProviders }) {
  const setKey = useSetOpenRouterKey();
  const [editing, setEditing] = useState(!data.openrouter.keySet);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setKeyError(null);
    try {
      await setKey.mutateAsync(key.trim());
      setKeyValue("");
      setEditing(false);
    } catch (err) {
      setKeyError(errorMessage(err, "Could not save the key."));
    }
  };

  if (!editing && data.openrouter.keySet) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ok">
          <KeyRound className="size-3" /> Key saved {data.openrouter.keyHint}
        </Badge>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Replace
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void onSave(event)} className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <AuthField
          id="setup-openrouter-key"
          label="OpenRouter API key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(event) => setKeyValue(event.target.value)}
          disabled={setKey.isPending}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={key.trim().length < 8}
          loading={setKey.isPending}
          leading={<Check />}
        >
          {setKey.isPending ? "Checking…" : "Save key"}
        </Button>
        {data.openrouter.keySet && (
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              setKeyError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {keyError ? (
        <p className="text-xs text-destructive" role="alert">
          {keyError}
        </p>
      ) : (
        <p className="text-xs text-[var(--lp-soft)]">
          Stored encrypted on this computer. Saving sends one tiny test request.
        </p>
      )}
    </form>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { instance, loading, error } = useDesktopInstance();
  const setting = useDesktopSetting();
  const providers = useAgentProviders();
  const rescan = useRescanProviders();
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const next = () => setStep((value) => Math.min(value + 1, STEPS.length - 1));
  const back = () => setStep((value) => Math.max(value - 1, 0));

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await setting.set("setupDone", true);
      router.replace("/calendar");
    } catch (err) {
      setFinishing(false);
      setFinishError(errorMessage(err, "Could not save. Try again."));
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[var(--lp-soft)]">
          <LogoSpinner size={16} label="Loading" /> Reading server status…
        </div>
      </main>
    );
  }

  if (!instance) {
    return (
      <AuthShell
        block={<NowBlock label="Setup" />}
        title="Nothing to set up here."
        lead={
          error
            ? `Could not read the server status: ${error}`
            : "This setup guide is only used by the Timely desktop app, which runs its own server."
        }
      >
        <Link href="/calendar" className={buttonClass({ size: "lg" })}>
          Go to the calendar <ArrowRight />
        </Link>
      </AuthShell>
    );
  }

  const tailscale = describeTailscale(
    instance.tailscale,
    instance.settings.tailscaleEnabled,
  );
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const intro: Record<(typeof STEPS)[number]["id"], string> = {
    tailscale:
      "Timely keeps everything on this computer. To use it from your phone, the two need a private link. Tailscale gives you one for free, and nothing is opened to the internet. If you only use Timely on this computer, skip this step.",
    openrouter:
      "The assistant in Timely needs a model to think with. The simplest option is OpenRouter: create a free account, add a little credit, and paste your key below. Keys from Anthropic, OpenAI, Gemini and others go under More API keys.",
    cli: "If you have a Claude or ChatGPT subscription, Timely can use the Claude Code or Codex command-line app installed on this computer instead of a key. Install the CLI, sign in from a terminal, then press Re-scan.",
    pair: "Install Timely on your phone, then scan this code. You can always find it again under Settings → Server.",
  };

  return (
    <AuthShell
      wide
      contentKey={current.id}
      block={
        <NowBlock
          label={`Step ${step + 1} of ${STEPS.length} · Setup`}
          color={current.color}
        />
      }
      title={`${current.title}.`}
      lead={intro[current.id]}
      aside={
        <DayPanel
          title="Setting up Timely"
          blocks={setupDay(step)}
          hoursBefore={2}
          hours={6}
        />
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={fadeTransition}
          className="flex flex-col gap-4"
          aria-labelledby={`setup-step-${current.id}`}
        >
          <h2 id={`setup-step-${current.id}`} className="sr-only">
            {current.title}
          </h2>

          {current.id === "tailscale" && (
            <>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--lp-soft)]">
                <li>Install Tailscale on this computer and sign in.</li>
                <li>
                  Install the Tailscale app on your phone (App Store or Google
                  Play) and sign in with the{" "}
                  <strong className="font-medium text-[var(--lp-ink)]">
                    same account
                  </strong>
                  . Leave it connected.
                </li>
                <li>
                  Turn on Tailscale access below. Timely on the phone then
                  reaches this computer from anywhere.
                </li>
              </ol>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--lp-soft)]">Tailscale:</span>
                <StatusBadge summary={tailscale} />
              </div>
              <div className="lp-day p-4">
                <AddressList instance={instance} />
              </div>
              {instance.tailscale.installed && (
                <Toggle
                  name="tailscaleEnabled"
                  label="Tailscale access"
                  description="Lets your phone reach Timely over Tailscale. Turning this on restarts the server for a few seconds."
                  checked={instance.settings.tailscaleEnabled}
                  busy={setting.pending === "tailscaleEnabled"}
                  onChange={(value) =>
                    void setting
                      .set("tailscaleEnabled", value)
                      .catch(() => undefined)
                  }
                />
              )}
              {setting.error && (
                <p className="text-xs text-destructive" role="alert">
                  {setting.error}
                </p>
              )}
            </>
          )}

          {current.id === "openrouter" && (
            <>
              <div className="lp-day flex flex-col gap-3 p-4">
                {providers.isLoading && (
                  <span className="flex items-center gap-2 text-sm text-[var(--lp-soft)]">
                    <LogoSpinner size={14} label="Checking" /> Checking…
                  </span>
                )}
                {providers.error && (
                  <span className="text-xs text-destructive">
                    {errorMessage(
                      providers.error,
                      "Could not check the assistant settings.",
                    )}
                  </span>
                )}
                {providers.data && <OpenRouterKeyForm data={providers.data} />}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs text-[var(--lp-now)] hover:underline"
                >
                  <ExternalLink className="size-3" /> Get a key at
                  openrouter.ai
                </a>
              </div>
              {providers.data && <MoreApiKeys data={providers.data} />}
              <p className="text-xs leading-relaxed text-[var(--lp-soft)]">
                Prefer a subscription you already pay for? The next step covers
                Claude Code and Codex.
              </p>
            </>
          )}

          {current.id === "cli" && (
            <>
              {providers.isLoading && (
                <span className="flex items-center gap-2 text-sm text-[var(--lp-soft)]">
                  <LogoSpinner size={14} label="Checking" /> Looking for the
                  CLIs…
                </span>
              )}
              {providers.error && (
                <p className="text-xs text-destructive">
                  {errorMessage(
                    providers.error,
                    "Could not check for the CLIs.",
                  )}
                </p>
              )}
              {providers.data && providers.data.localCli && (
                <div className="flex flex-col gap-2">
                  <CliRow id="claude" view={providers.data.claude} />
                  <CliRow id="codex" view={providers.data.codex} />
                </div>
              )}
              {providers.data && !providers.data.localCli && (
                <p className="text-xs text-[var(--lp-soft)]">
                  Claude Code and Codex are turned off on this server.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => rescan.mutate()}
                  disabled={providers.isLoading}
                  loading={rescan.isPending}
                  leading={<ScanSearch />}
                >
                  {rescan.isPending ? "Scanning…" : "Re-scan"}
                </Button>
                {rescan.error && (
                  <span className="text-xs text-destructive">
                    {errorMessage(rescan.error, "Could not re-scan.")}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--lp-soft)]">
                Connect and pick a model later in Settings → Agent.
              </p>
            </>
          )}

          {current.id === "pair" && (
            <>
              {instance.api.tailscaleUrls.length > 0 && (
                <p className="text-xs text-[var(--lp-soft)]">
                  The phone needs the Tailscale app, signed in with the same
                  account as this computer, to use the Tailscale address in this
                  code.
                </p>
              )}
              <div className="lp-day p-4">
                <PairingQr instance={instance} />
              </div>
              {instance.api.tailscaleUrls.length === 0 && (
                <p className="text-xs leading-relaxed text-[var(--lp-soft)]">
                  Without Tailscale, the phone can only reach Timely while it is
                  on this computer’s own network address, which usually means
                  not at all. You can come back to this after installing
                  Tailscale.
                </p>
              )}
            </>
          )}
        </motion.section>
      </AnimatePresence>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--lp-line)] pt-5">
        {!isLast ? (
          <Button size="lg" onClick={next} trailing={<ArrowRight />}>
            Next
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => void finish()}
            loading={finishing}
            leading={<Check />}
          >
            Finish
          </Button>
        )}
        {!isLast && (
          <Button variant="ghost" size="lg" onClick={next}>
            Skip
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          onClick={back}
          disabled={step === 0 || finishing}
          leading={<ArrowLeft />}
        >
          Back
        </Button>
        {finishError && (
          <span className="text-xs text-destructive" role="alert">
            {finishError}
          </span>
        )}
      </div>
      <p className="mt-4 text-xs text-[var(--lp-soft)]">
        A few one-time choices. You can change any of them later in Settings.
      </p>
    </AuthShell>
  );
}
