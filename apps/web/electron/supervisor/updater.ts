// electron-updater adapter. The only supervisor module that touches Electron
// packages; main.ts wires it into the Supervisor as `deps.updater`.
import type { Updater, UpdateStatus } from "./index.ts";

type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

/**
 * Wraps electron-updater's autoUpdater. Nothing here throws out of `check` or
 * `install`: an unpackaged run, a missing feed or a network error becomes an
 * `error` (or `idle`) status so the renderer can show it.
 */
export function createElectronUpdater(options: { isPackaged: boolean; log?: (message: string) => void }): Updater {
  let status: UpdateStatus = { status: "idle" };
  let listener: ((status: UpdateStatus) => void) | null = null;
  let updater: AutoUpdaterLike | null = null;
  let downloaded = false;

  const set = (next: UpdateStatus) => {
    status = next;
    listener?.(status);
  };

  function load(): AutoUpdaterLike {
    if (updater) return updater;
    // Lazy so a build without the module still boots.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron-updater") as { autoUpdater: AutoUpdaterLike };
    const auto = mod.autoUpdater;
    auto.autoDownload = false;
    auto.autoInstallOnAppQuit = true;
    auto.logger = null;
    auto.on("checking-for-update", () => set({ status: "checking" }));
    auto.on("update-available", (info: { version?: string }) => {
      downloaded = false;
      set({ status: "available", version: info?.version });
      // The contract: check → download → install. Start the download at once.
      set({ status: "downloading", version: info?.version });
      auto.downloadUpdate().catch((error: unknown) => set({ status: "error", version: info?.version, error: message(error) }));
    });
    auto.on("update-not-available", () => set({ status: "upToDate" }));
    auto.on("download-progress", () => {
      if (status.status !== "downloading") set({ status: "downloading", version: status.version });
    });
    auto.on("update-downloaded", (info: { version?: string }) => {
      downloaded = true;
      set({ status: "ready", version: info?.version ?? status.version });
    });
    auto.on("error", (error: unknown) => set({ status: "error", version: status.version, error: message(error) }));
    updater = auto;
    return auto;
  }

  return {
    onStatus(callback) {
      listener = callback;
    },
    async check() {
      if (!options.isPackaged) {
        set({ status: "error", error: "Updates only work in the installed app." });
        return;
      }
      try {
        const auto = load();
        set({ status: "checking" });
        const result = await auto.checkForUpdates();
        if (result === null && status.status === "checking") set({ status: "upToDate" });
      } catch (error) {
        options.log?.(`updater: check failed: ${message(error)}`);
        set({ status: "error", error: friendly(error) });
      }
    },
    async install() {
      try {
        const auto = load();
        if (downloaded || status.status === "ready") {
          auto.quitAndInstall(false, true);
          return;
        }
        if (status.status === "available" || status.status === "downloading") {
          set({ status: "downloading", version: status.version });
          await auto.downloadUpdate();
          auto.quitAndInstall(false, true);
          return;
        }
        set({ status: "error", version: status.version, error: "No update has been downloaded yet. Check for updates first." });
      } catch (error) {
        options.log?.(`updater: install failed: ${message(error)}`);
        set({ status: "error", version: status.version, error: friendly(error) });
      }
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function friendly(error: unknown): string {
  const text = message(error);
  if (/not packed|isPackaged|app-update\.yml|dev-app-update/i.test(text)) return "Updates only work in the installed app.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|fetch failed/i.test(text)) return "Could not reach the update server. Check your connection and try again.";
  return text;
}
