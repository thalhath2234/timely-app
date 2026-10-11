"use client";

import { useState } from "react";
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
import { cn } from "@/app/utils/cn";
import { describeTailscale } from "@/app/utils/desktopInstance";
import { useDesktopInstance, useDesktopSetting } from "@/app/utils/hooks/desktop";
import { useAgentProviders, useRescanProviders } from "@/app/utils/hooks/agentProviders";
import { PROVIDER_LABELS, type CliProviderView } from "@/app/utils/api/agentProviders";
import { Badge, CLI_INSTALL_URLS } from "@/app/_components/settings/agentSettings";
import { AddressList, StatusBadge, Toggle } from "@/app/_components/settings/serverSettings";
import PairingQr from "@/app/_components/settings/pairingQr";

const primaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-60";

const STEPS = [
  { id: "tailscale", title: "Reach Timely from anywhere" },
  { id: "openrouter", title: "Choose how the assistant thinks" },
  { id: "cli", title: "Use Claude Code or Codex" },
  { id: "pair", title: "Pair your phone" },
] as const;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function CliRow({ id, view }: { id: "claude" | "codex"; view: CliProviderView }) {
  const status = view.status;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{PROVIDER_LABELS[id]}</span>
        <div className="flex flex-wrap items-center gap-2">
          {status.found ? (
            <Badge tone="ok">
              <TerminalSquare className="size-3" /> Found{status.version ? ` · ${status.version}` : ""}
            </Badge>
          ) : (
            <Badge tone="warn">
              <CircleAlert className="size-3" /> Not found on this computer
            </Badge>
          )}
          {status.found && status.loggedIn && (
            <Badge tone="ok">
              <ShieldCheck className="size-3" /> Signed in{status.account ? ` · ${status.account}` : ""}
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
        <a href={CLI_INSTALL_URLS[id]} target="_blank" rel="noreferrer" className={secondaryButton}>
          <ExternalLink className="size-3.5" /> Install {PROVIDER_LABELS[id]}
        </a>
      )}
    </div>
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
      <main className="flex h-full items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LogoSpinner size={16} label="Loading" /> Reading server status…
        </div>
      </main>
    );
  }

  if (!instance) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Nothing to set up here</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {error
            ? `Could not read the server status: ${error}`
            : "This setup guide is only used by the Timely desktop app, which runs its own server."}
        </p>
        <Link href="/calendar" className={primaryButton}>
          Go to the calendar <ArrowRight className="size-4" />
        </Link>
      </main>
    );
  }

  const tailscale = describeTailscale(instance.tailscale, instance.settings.tailscaleEnabled);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-primary uppercase">
          Step {step + 1} of {STEPS.length}
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{current.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A few one-time choices. You can change any of them later in Settings.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <ol className="mb-6 flex flex-wrap gap-2" aria-label="Setup steps">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                index === step
                  ? "bg-primary/12 text-primary"
                  : index < step
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {index < step ? <Check className="size-3" /> : <span>{index + 1}.</span>}
              {item.title}
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={current.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={fadeTransition}
            className="flex max-w-2xl flex-col gap-4"
            aria-labelledby={`setup-step-${current.id}`}
          >
            <h2 id={`setup-step-${current.id}`} className="sr-only">
              {current.title}
            </h2>

            {current.id === "tailscale" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Timely keeps everything on this computer. To use it from your phone, the two need
                  a private link. Tailscale gives you one for free, and nothing is opened to the
                  internet. If you only use Timely on this computer, skip this step.
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Install Tailscale on this computer and sign in.</li>
                  <li>
                    Install the Tailscale app on your phone (App Store or Google Play) and sign in
                    with the <strong className="font-medium text-foreground">same account</strong>.
                    Leave it connected.
                  </li>
                  <li>Turn on Tailscale access below. Timely on the phone then reaches this computer from anywhere.</li>
                </ol>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Tailscale:</span>
                  <StatusBadge summary={tailscale} />
                </div>
                <div className="rounded-xl border border-border p-4">
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
                      void setting.set("tailscaleEnabled", value).catch(() => undefined)
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
                <p className="text-sm text-muted-foreground">
                  The assistant in Timely needs a model to think with. The simplest option is
                  OpenRouter: create a free account, add a little credit, and paste your key into
                  Settings → Agent. The key stays on this computer, encrypted.
                </p>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-4">
                  {providers.isLoading && (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LogoSpinner size={14} label="Checking" /> Checking…
                    </span>
                  )}
                  {providers.data?.openrouter.keySet && (
                    <Badge tone="ok">
                      <KeyRound className="size-3" /> Key saved {providers.data.openrouter.keyHint}
                    </Badge>
                  )}
                  {providers.data && !providers.data.openrouter.keySet && (
                    <Badge tone="warn">
                      <CircleAlert className="size-3" /> No key yet
                    </Badge>
                  )}
                  {providers.error && (
                    <span className="text-xs text-destructive">
                      {errorMessage(providers.error, "Could not check the assistant settings.")}
                    </span>
                  )}
                  <Link href="/settings?tab=agent" className={secondaryButton}>
                    <KeyRound className="size-3.5" /> Add an OpenRouter key
                  </Link>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Get a key at openrouter.ai
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  Already have a key from Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral, Z.ai,
                  Kimi, NVIDIA or OpenCode, or run Ollama? Add it under More API keys in
                  Settings → Agent instead. Prefer a subscription you already pay for? The next step
                  covers Claude Code and Codex.
                </p>
              </>
            )}

            {current.id === "cli" && (
              <>
                <p className="text-sm text-muted-foreground">
                  If you have a Claude or ChatGPT subscription, Timely can use the Claude Code or
                  Codex command-line app installed on this computer instead of a key. Install the
                  CLI, sign in from a terminal, then press Re-scan.
                </p>
                {providers.isLoading && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LogoSpinner size={14} label="Checking" /> Looking for the CLIs…
                  </span>
                )}
                {providers.error && (
                  <p className="text-xs text-destructive">
                    {errorMessage(providers.error, "Could not check for the CLIs.")}
                  </p>
                )}
                {providers.data && providers.data.localCli && (
                  <div className="flex flex-col gap-2">
                    <CliRow id="claude" view={providers.data.claude} />
                    <CliRow id="codex" view={providers.data.codex} />
                  </div>
                )}
                {providers.data && !providers.data.localCli && (
                  <p className="text-xs text-muted-foreground">
                    Claude Code and Codex are turned off on this server.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => rescan.mutate()}
                    disabled={rescan.isPending || providers.isLoading}
                    className={secondaryButton}
                  >
                    {rescan.isPending ? (
                      <LogoSpinner size={14} label="Scanning" />
                    ) : (
                      <ScanSearch className="size-3.5" />
                    )}
                    {rescan.isPending ? "Scanning…" : "Re-scan"}
                  </button>
                  {rescan.error && (
                    <span className="text-xs text-destructive">
                      {errorMessage(rescan.error, "Could not re-scan.")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Connect and pick a model later in Settings → Agent.
                </p>
              </>
            )}

            {current.id === "pair" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Install Timely on your phone, then scan this code. You can always find it again
                  under Settings → Server.
                </p>
                {instance.api.tailscaleUrls.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    The phone needs the Tailscale app, signed in with the same account as this
                    computer, to use the Tailscale address in this code.
                  </p>
                )}
                <div className="rounded-xl border border-border p-4">
                  <PairingQr instance={instance} />
                </div>
                {instance.api.tailscaleUrls.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Without Tailscale, the phone can only reach Timely while it is on this computer’s
                    own network address, which usually means not at all. You can come back to this
                    after installing Tailscale.
                  </p>
                )}
              </>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
        <button type="button" onClick={back} disabled={step === 0 || finishing} className={secondaryButton}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          {finishError && (
            <span className="text-xs text-destructive" role="alert">
              {finishError}
            </span>
          )}
          {!isLast && (
            <button type="button" onClick={next} className={secondaryButton}>
              Skip
            </button>
          )}
          {!isLast ? (
            <button type="button" onClick={next} className={primaryButton}>
              Next <ArrowRight className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={() => void finish()} disabled={finishing} className={primaryButton}>
              {finishing ? <LogoSpinner size={14} tone="mono" label="Saving" /> : <Check className="size-4" />}
              Finish
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
