/**
 * Pure helpers for the desktop bridge (`window.timelyDesktop.instance`).
 * No React, no window access: safe to unit test with node.
 * Contract: docs/desktop/README.md, types in apps/web/electron-env.d.ts.
 */
import type { DesktopInstance, SidecarState } from "@/electron-env";

export type StatusTone = "ok" | "warn" | "muted" | "danger";

export type StatusSummary = {
  label: string;
  tone: StatusTone;
  /** One extra line for the person, when there is something to say. */
  detail?: string;
};

/** The exact text the Settings → Server QR code encodes; `code` signs the phone in too. */
export function pairingPayload(instance: Pick<DesktopInstance, "pairing">, code?: string): string {
  return JSON.stringify(code ? { ...instance.pairing, code } : instance.pairing);
}

/** "4:05" until `expiresAt`, or null once it has passed. */
export function codeTimeLeft(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function describeHttps(instance: Pick<DesktopInstance, "tailscale" | "settings">): StatusSummary {
  const https = instance.tailscale.https;
  if (!instance.settings.tailscaleEnabled || !instance.settings.tailscaleHttps) return { label: "Off", tone: "muted" };
  switch (https.status) {
    case "on":
      return { label: "On", tone: "ok", detail: https.url ? `The phone uses ${https.url} first.` : undefined };
    case "starting":
      return { label: "Setting up…", tone: "warn", detail: "Tailscale may take a few seconds to get a certificate." };
    case "error":
      return { label: "Not working", tone: "danger", detail: https.error };
    case "off":
    default:
      return { label: "Off", tone: "muted" };
  }
}

/** Addresses the phone will try, in order. */
export function pairingUrls(instance: Pick<DesktopInstance, "pairing">): string[] {
  return instance.pairing.urls;
}

/** The address to show for manual entry and to copy. */
export function primaryAddress(instance: Pick<DesktopInstance, "pairing" | "api">): string {
  return instance.pairing.urls[0] ?? instance.api.localUrl;
}

export function describeSidecar(state: SidecarState): StatusSummary {
  switch (state.status) {
    case "running":
      return {
        label: "Running",
        tone: "ok",
        detail:
          state.restarts > 0
            ? `Restarted ${state.restarts} time${state.restarts === 1 ? "" : "s"} recently`
            : undefined,
      };
    case "starting":
      return { label: "Starting…", tone: "warn" };
    case "crashed":
      return {
        label: "Stopped unexpectedly",
        tone: "danger",
        detail: state.lastError || "Timely will try to start it again.",
      };
    case "stopped":
    default:
      return { label: "Stopped", tone: "muted", detail: state.lastError };
  }
}

export function describeTailscale(
  tailscale: DesktopInstance["tailscale"],
  enabled: boolean,
): StatusSummary {
  if (!tailscale.installed) {
    return {
      label: "Not installed",
      tone: "muted",
      detail: "Install Tailscale to reach Timely from your phone.",
    };
  }
  if (!tailscale.running) {
    return {
      label: "Installed but not connected",
      tone: "warn",
      detail: "Tailscale is installed but not connected. Open Tailscale and sign in.",
    };
  }
  if (!enabled) {
    return {
      label: "Connected, Tailscale access off",
      tone: "muted",
      detail: "Turn on Tailscale access below so your phone can reach Timely from anywhere.",
    };
  }
  return {
    label: "Connected",
    tone: "ok",
    detail: tailscale.hostname ? `This computer is “${tailscale.hostname}” on Tailscale.` : undefined,
  };
}

export function describeUpdate(update: DesktopInstance["update"]): StatusSummary {
  switch (update.status) {
    case "checking":
      return { label: "Checking for updates…", tone: "warn" };
    case "available":
      return {
        label: update.version ? `Version ${update.version} is available` : "An update is available",
        tone: "ok",
      };
    case "downloading":
      return {
        label: update.version ? `Downloading version ${update.version}…` : "Downloading the update…",
        tone: "warn",
      };
    case "ready":
      return {
        label: update.version ? `Version ${update.version} is ready to install` : "Update ready to install",
        tone: "ok",
      };
    case "upToDate":
      return { label: "You have the latest version", tone: "ok" };
    case "error":
      return { label: "Update check failed", tone: "danger", detail: update.error };
    case "managed":
      return { label: "Updated by your package manager", tone: "muted" };
    case "idle":
    default:
      return { label: "Not checked yet", tone: "muted" };
  }
}

/** The Tailscale toggle is usable only when Tailscale is on this computer. */
export function canToggleTailscale(instance: Pick<DesktopInstance, "tailscale">): boolean {
  return instance.tailscale.installed;
}

/** Where the app goes once onboarding finishes: the desktop app runs the
 * first-run wizard once, every other case lands on the calendar. */
export function routeAfterOnboarding(instance: Pick<DesktopInstance, "settings"> | null): "/setup" | "/calendar" {
  return instance && !instance.settings.setupDone ? "/setup" : "/calendar";
}
