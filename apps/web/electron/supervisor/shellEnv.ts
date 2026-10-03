// Login-shell PATH/HOME for the API sidecar (ADR 0009/0011): the Go API finds
// `claude` and `codex` the same way a terminal would. Electron-free.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type ShellEnv = { PATH: string; HOME: string };

const EXTRA_DIRS = ["/usr/local/bin", "/opt/homebrew/bin", "~/.local/bin"];

/** Appends the usual user-binary directories that a non-login process misses. */
export function fallbackPath(current: string | undefined, home: string, platform = process.platform): string {
  if (platform === "win32") return current ?? "";
  const parts = (current ?? "").split(":").filter(Boolean);
  for (const dir of EXTRA_DIRS) {
    const resolved = dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
    if (!parts.includes(resolved)) parts.push(resolved);
  }
  return parts.join(":");
}

/** Interactive shells may print banners; the PATH is the last non-empty line. */
export function lastLine(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function queryLoginShellPath(shell: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-l", "-i", "-c", 'printf "%s\\n" "$PATH"'],
      { timeout: timeoutMs, env: { ...process.env, TERM: "dumb" }, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const line = lastLine(stdout);
        resolve(line && line.includes("/") ? line : null);
      },
    );
  });
}

let cached: Promise<ShellEnv> | null = null;

/**
 * Resolves PATH and HOME once per process. On Windows the process env is the
 * truth; on macOS/Linux the login shell is asked (5 s cap) and the current
 * PATH plus the usual extras is the fallback.
 */
export function resolveShellEnv(options: { platform?: NodeJS.Platform; timeoutMs?: number } = {}): Promise<ShellEnv> {
  if (cached) return cached;
  cached = (async () => {
    const platform = options.platform ?? process.platform;
    const HOME = process.env.HOME || os.homedir();
    if (platform === "win32") {
      return { PATH: process.env.PATH ?? process.env.Path ?? "", HOME: process.env.USERPROFILE ?? HOME };
    }
    const shell = process.env.SHELL || "/bin/sh";
    const fromShell = await queryLoginShellPath(shell, options.timeoutMs ?? 5000);
    return { PATH: fallbackPath(fromShell ?? process.env.PATH, HOME, platform), HOME };
  })();
  return cached;
}
