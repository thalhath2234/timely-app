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
  };
  settings: {
    tailscaleEnabled: boolean;
    allowRegistration: boolean;
    setupDone: boolean;
  };
  /** What the Settings → Server QR encodes; see "Pairing payload" in the contract. */
  pairing: { v: 1; name: string; urls: string[] };
  update: {
    status: "idle" | "checking" | "available" | "downloading" | "ready" | "upToDate" | "error";
    version?: string;
    error?: string;
  };
};

export type DesktopSettingKey = "tailscaleEnabled" | "allowRegistration" | "setupDone";

export type DesktopAction =
  | "restartApi"
  | "backupNow"
  | "openDataFolder"
  | "openLogs"
  | "checkForUpdates"
  | "installUpdate"
  | "copyAddress";

/** Tab shortcuts the app forwards while doc/sheet tabs are showing. */
export type PageTabCommand = "new" | "close" | "next" | "previous" | "back" | "forward";

export type DesktopActionResult = { ok: true; message?: string } | { ok: false; error: string };

export type TimelyDesktop = {
  platform: NodeJS.Platform;
  notifyChat: (payload: { id: string; title: string; body: string; revision: number }) => void;
  onOpenChat: (callback: (id: string) => void) => () => void;
  /** Saves the page, as laid out for print, to a PDF the user picks. */
  savePdf?: (title: string) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  /** Tells the app whether doc/sheet tabs are showing (see PageTabCommand). */
  setPageTabsActive?: (active: boolean) => void;
  onPageTabCommand?: (callback: (command: PageTabCommand) => void) => () => void;
  /** Present only when the app hosts its own backend (packaged build). */
  instance?: {
    get: () => Promise<DesktopInstance>;
    subscribe: (callback: (instance: DesktopInstance) => void) => () => void;
    setSetting: (key: DesktopSettingKey, value: boolean) => Promise<DesktopInstance>;
    action: (name: DesktopAction) => Promise<DesktopActionResult>;
  };
};

declare global {
  interface Window {
    timelyDesktop?: TimelyDesktop;
  }
}

export {};
