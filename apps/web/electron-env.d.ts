/**
 * The desktop bridge exposed by electron/preload.ts as `window.timelyDesktop`.
 * It exists only inside the Electron app; the web app treats it as optional.
 * Contract: docs/desktop/README.md (ADR 0011).
 */

export type SidecarStatus = "stopped" | "starting" | "running" | "crashed";

export type SidecarState = {
  status: SidecarStatus;
  /** Crash restarts since the last healthy minute. */
  restarts: number;
  lastError?: string;
  pid?: number;
};

export type DesktopInstance = {
  version: string;
  platform: NodeJS.Platform;
  dataDir: string;
  logDir: string;
  api: SidecarState & {
    port: number;
    /** http://127.0.0.1:<port> */
    localUrl: string;
    /** http://<tailscale-ip>:<port> entries, empty when disabled or not detected. */
    tailscaleUrls: string[];
    bind: string[];
  };
  postgres: SidecarState & { port: number; version?: string };
  web: SidecarState & { port: number };
  tailscale: {
    installed: boolean;
    /** The host has a Tailscale address right now. */
    running: boolean;
    ipv4?: string;
    ipv6?: string;
    hostname?: string;
    /** MagicDNS name (host.tailnet.ts.net); needed for HTTPS. */
    dnsName?: string;
    /** Tailscale Serve: https://<dnsName>/ proxied to the API. */
    https: {
      status: "off" | "starting" | "on" | "error";
      url?: string;
      error?: string;
    };
  };
  settings: {
    tailscaleEnabled: boolean;
    tailscaleHttps: boolean;
    allowRegistration: boolean;
    setupDone: boolean;
    /** Start hidden in the tray when the person signs in to the computer. */
    startAtLogin: boolean;
  };
  /**
   * Start at login as the system has it. `supported` is false outside the
   * installed app (and on other platforms). `blockedBySystem`: start at login
   * is on here, but Windows (Startup apps) or the desktop turned the entry off.
   * `notice`: the one-time notice for upgraders is still owed.
   */
  loginItem: { supported: boolean; blockedBySystem: boolean; notice: boolean };
  /** What the Settings → Server QR encodes; see "Pairing payload" in the contract. */
  pairing: { v: 1; name: string; id?: string; urls: string[]; code?: string };
  update: {
    status: "idle" | "checking" | "available" | "downloading" | "ready" | "upToDate" | "error" | "managed";
    version?: string;
    error?: string;
  };
};

export type DesktopSettingKey = "tailscaleEnabled" | "tailscaleHttps" | "allowRegistration" | "setupDone" | "startAtLogin";

export type DesktopAction =
  | "restartApi"
  | "backupNow"
  | "openDataFolder"
  | "openLogs"
  | "checkForUpdates"
  | "installUpdate"
  | "copyAddress"
  | "dismissLoginNotice";

/** `cleared` (dismissLoginNotice): this caller used up the notice and alone shows it. */
export type DesktopActionResult = { ok: true; message?: string; cleared?: boolean } | { ok: false; error: string };

/**
 * The requests the desktop window may send to the API as the desktop window
 * (electron/shellOps.ts is the one list). Anything else is refused.
 */
export type ShellOp =
  | "instance.settings"
  | "hostAccounts.set"
  | "hostAccounts.workingDir"
  | "agentLimits.set"
  | "chat.permission"
  | "settings.permissions"
  | "chat.hostApproval";

/** What the API answered; `body` is its JSON (or its text). */
export type ShellResult = { ok: boolean; status: number; body: unknown };

export type TimelyDesktop = {
  platform: NodeJS.Platform;
  notifyChat: (payload: { id: string; title: string; body: string; revision: number }) => void;
  onOpenChat: (callback: (id: string) => void) => () => void;
  /** Pops a Bot alert as a native notification (once per id, only when the window is not focused). */
  notifyAlert?: (payload: { id: string; title: string; body: string }) => void;
  /** Called with the notification id when a Bot alert pop-up is clicked. */
  onOpenAlert?: (callback: (id: string) => void) => () => void;
  /** Saves the page, as laid out for print, to a PDF the user picks. */
  savePdf?: (title: string) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
  /** Moves the mouse pointer to a point in the page (CSS pixels); no-op where the OS forbids it (Wayland). */
  snapPointer?: (x: number, y: number) => void;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  /** Present only when the app hosts its own backend (packaged build). */
  instance?: {
    get: () => Promise<DesktopInstance>;
    subscribe: (callback: (instance: DesktopInstance) => void) => () => void;
    setSetting: (key: DesktopSettingKey, value: boolean) => Promise<DesktopInstance>;
    action: (name: DesktopAction) => Promise<DesktopActionResult>;
  };
  /**
   * Present only when the app hosts its own backend. The main process adds the
   * per-launch credential and the window's session; the page never holds
   * either. Its presence is how a page knows it is in the desktop window.
   */
  shell?: {
    request: (op: ShellOp, body?: Record<string, string | number | boolean | null>) => Promise<ShellResult>;
    /** A native folder picker; the chosen path is for hostAccounts.workingDir. */
    pickFolder: () => Promise<{ canceled: true } | { canceled: false; path: string }>;
  };
};

declare global {
  interface Window {
    timelyDesktop?: TimelyDesktop;
  }
}

export {};
