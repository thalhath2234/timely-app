// Pre-boot guard rails: PostgreSQL refuses to run as root/Administrator, so
// the app refuses first with a plain-language message. Electron-free.
import { execFileSync } from "node:child_process";

export type GuardResult = { ok: true } | { ok: false; title: string; message: string };

const WINDOWS_HIGH_INTEGRITY_SID = "S-1-16-12288";

export function isElevatedWindows(run: (file: string, args: string[]) => string = runQuiet): boolean {
  try {
    run("net", ["session"]);
    return true;
  } catch {
    // `net session` fails without elevation; double-check the integrity level.
  }
  try {
    return run("whoami", ["/groups"]).includes(WINDOWS_HIGH_INTEGRITY_SID);
  } catch {
    return false;
  }
}

function runQuiet(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 });
}

export function checkPrivileges(options: {
  platform?: NodeJS.Platform;
  getuid?: () => number;
  elevated?: () => boolean;
} = {}): GuardResult {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const elevated = options.elevated ?? isElevatedWindows;
    if (elevated()) {
      return {
        ok: false,
        title: "Timely cannot run as Administrator",
        message:
          "Timely's built-in database refuses to start with Administrator rights. Close this window and open Timely normally (without \"Run as administrator\").",
      };
    }
    return { ok: true };
  }
  if (platform === "linux" || platform === "darwin") {
    const getuid = options.getuid ?? process.getuid;
    if (getuid && getuid() === 0) {
      return {
        ok: false,
        title: "Timely cannot run as root",
        message: "Timely's built-in database refuses to start as root. Open Timely from your normal user account instead of with sudo.",
      };
    }
  }
  return { ok: true };
}
