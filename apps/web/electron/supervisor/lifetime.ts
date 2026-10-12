// Keeps the sidecars from outliving the app. Electron-free.
//
// A clean quit stops every sidecar (Supervisor.shutdown), but when the app
// dies without one (crash, OOM kill, a lost Wayland/X session, `kill -9`)
// its children used to live on: the Next server kept its memory (gigabytes
// after a few days), and the next start picked a new web port beside it.
// Four layers, so no single one has to be perfect:
//
// 1. Lifeline: the API and Next get a pipe on stdin that the app never writes
//    to. When the app exits the OS closes it, and both exit on EOF
//    (apps/api/internal/lifeline, electron/next-guard.cjs). Every platform.
// 2. Linux: each sidecar runs under `setpriv --pdeathsig`, so the kernel
//    signals it when the app's process ends, however it ends. PostgreSQL has
//    no lifeline of its own, so this is what stops it promptly on Linux.
// 3. Windows: libuv puts every child it spawns in a kill-on-close job object,
//    so Windows already ends them with the app.
// 4. Boot sweep (Linux): servers an earlier run left behind (including
//    versions without layers 1-2) are found by our JWT secret in their
//    environment and stopped before anything binds a port. A leftover
//    postmaster is reclaimed through postmaster.pid (postgres.ts).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";
import { sleep } from "./sidecar.ts";

/** Env var the API and the Next guard read; "stdin" turns the lifeline on. */
export const LIFELINE_ENV = "TIMELY_LIFELINE";

export type DeathSignal = "KILL" | "TERM" | "INT";

let setprivChecked: boolean | null = null;

/**
 * Whether `setpriv --pdeathsig` works here (util-linux 2.33+; on every
 * mainstream distro, but checked rather than assumed).
 */
export function hasSetpriv(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  if (setprivChecked === null) {
    try {
      execFileSync("setpriv", ["--pdeathsig", "TERM", "--", "true"], { stdio: "ignore", timeout: 5_000 });
      setprivChecked = true;
    } catch {
      setprivChecked = false;
    }
  }
  return setprivChecked;
}

/**
 * The command that runs `binary args` so the kernel sends it `signal` when
 * this process ends. setpriv sets the death signal and then execs the binary
 * in place (same pid), so stopping it by pid works as before. Without
 * setpriv, the command is returned unchanged.
 */
export function withDeathSignal(
  binary: string,
  args: string[],
  signal: DeathSignal,
  available: boolean,
): { command: string; args: string[] } {
  if (!available) return { command: binary, args };
  return { command: "setpriv", args: ["--pdeathsig", signal, "--", binary, ...args] };
}

export type OrphanKind = "web" | "api";
export type Orphan = { pid: number; kind: OrphanKind };

/**
 * Sidecars of this app that are not children of `selfPid`, found through
 * /proc (Linux; elsewhere the list is empty). A process is ours when its
 * environment carries JWT_SECRET=<our secret>: the secret is random per
 * user-data folder, and the single-instance lock means no other live copy of
 * this app uses that folder, so a match that is not our child is an orphan.
 * A local "Timely Dev" build has its own folder and secret and is never
 * matched by the release (or the other way round). /proc/<pid>/environ is
 * only readable for our own processes, so other users' are skipped.
 */
export function findOrphans(input: { secret: string; selfPid: number; procRoot?: string }): Orphan[] {
  const procRoot = input.procRoot ?? "/proc";
  if (!input.secret) return [];
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return [];
  }
  const marker = `JWT_SECRET=${input.secret}`;
  const orphans: Orphan[] = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === input.selfPid) continue;
    let env: string[];
    try {
      env = readFileSync(path.join(procRoot, name, "environ"), "latin1").split("\0");
    } catch {
      continue;
    }
    if (!env.includes(marker)) continue;
    if (parentPid(procRoot, name) === input.selfPid) continue;
    // The API is the one told where the data lives; Next is told where the API is.
    const kind: OrphanKind | null = env.some((entry) => entry.startsWith("TIMELY_DATA_DIR="))
      ? "api"
      : env.some((entry) => entry.startsWith("API_ORIGIN="))
        ? "web"
        : null;
    if (kind) orphans.push({ pid, kind });
  }
  return orphans;
}

/** Field 4 of /proc/<pid>/stat; the command name (field 2) may hold spaces and parentheses. */
export function parseStatParent(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const ppid = Number.parseInt(stat.slice(close + 2).split(" ")[1] ?? "", 10);
  return Number.isInteger(ppid) ? ppid : null;
}

function parentPid(procRoot: string, name: string): number | null {
  try {
    return parseStatParent(readFileSync(path.join(procRoot, name, "stat"), "latin1"));
  } catch {
    return null;
  }
}

/** Field 3 of /proc/<pid>/stat: "Z" is a zombie, already dead but not yet reaped. */
export function parseStatState(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  return close < 0 ? null : (stat.slice(close + 2).split(" ")[0] ?? null);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  try {
    return parseStatState(readFileSync(`/proc/${pid}/stat`, "latin1")) !== "Z";
  } catch {
    return true;
  }
}

/**
 * SIGTERM, then SIGKILL for whatever is still running after `graceMs`.
 * Resolves once every pid is gone or the kill was sent.
 */
export async function stopOrphans(
  orphans: Orphan[],
  options: { graceMs?: number; log?: Logger; kill?: (pid: number, signal: NodeJS.Signals) => void; isAlive?: (pid: number) => boolean } = {},
): Promise<void> {
  const log = options.log ?? silentLogger;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  const isAlive = options.isAlive ?? alive;
  const graceMs = options.graceMs ?? 5_000;
  const pending = new Set<number>();
  for (const orphan of orphans) {
    log.warn(`orphans: ${orphan.kind === "api" ? "an API" : "a web"} server from an earlier run is still running (pid ${orphan.pid}); stopping it`);
    try {
      kill(orphan.pid, "SIGTERM");
      pending.add(orphan.pid);
    } catch {
      // Already gone.
    }
  }
  const deadline = Date.now() + graceMs;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const pid of pending) if (!isAlive(pid)) pending.delete(pid);
    if (pending.size > 0) await sleep(100);
  }
  for (const pid of pending) {
    log.warn(`orphans: pid ${pid} ignored SIGTERM; killing it`);
    try {
      kill(pid, "SIGKILL");
    } catch {
      // Exited just now.
    }
  }
}
