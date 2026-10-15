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
//    versions without layers 1-2) are found through /proc and stopped before
//    anything binds a port. A leftover postmaster is reclaimed through
//    postmaster.pid (postgres.ts).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";
import { sleep } from "./sidecar.ts";

/** Env var the API and the Next guard read; "stdin" turns the lifeline on. */
export const LIFELINE_ENV = "TIMELY_LIFELINE";

export type DeathSignal = "KILL" | "TERM" | "INT";

let setprivChecked: { path: string | null } | null = null;

/**
 * Absolute path of a `setpriv` that supports --pdeathsig (util-linux 2.33+;
 * on every mainstream distro, but checked rather than assumed), or null. The
 * path is absolute because a sidecar is spawned with its own PATH (the API
 * gets the login shell's), which may not find the same setpriv.
 */
export function setprivPath(platform: NodeJS.Platform = process.platform, envPath: string = process.env.PATH ?? ""): string | null {
  if (platform !== "linux") return null;
  if (setprivChecked === null) {
    setprivChecked = { path: null };
    const dirs = [...envPath.split(path.delimiter), "/usr/bin", "/bin"].filter((dir) => path.isAbsolute(dir));
    for (const dir of new Set(dirs)) {
      const candidate = path.join(dir, "setpriv");
      if (!existsSync(candidate)) continue;
      try {
        execFileSync(candidate, ["--pdeathsig", "TERM", "--", "true"], { stdio: "ignore", timeout: 5_000 });
        setprivChecked = { path: candidate };
      } catch {
        // busybox and old util-linux have no --pdeathsig; try the next one.
        continue;
      }
      break;
    }
  }
  return setprivChecked.path;
}

/**
 * The command that runs `binary args` so the kernel sends it `signal` when
 * this process ends. setpriv sets the death signal and then execs the binary
 * in place (same pid), so stopping it by pid works as before. Without
 * setpriv (null), the command is returned unchanged.
 */
export function withDeathSignal(
  binary: string,
  args: string[],
  signal: DeathSignal,
  setpriv: string | null,
): { command: string; args: string[] } {
  if (!setpriv) return { command: binary, args };
  return { command: setpriv, args: ["--pdeathsig", signal, "--", binary, ...args] };
}

export type OrphanKind = "web" | "api";
export type Orphan = { pid: number; kind: OrphanKind };

/** What /proc says about one process; null fields could not be read. */
export type ProcInfo = { env: string[]; exe: string | null; cwd: string | null; comm: string | null };

/** readlink of /proc/<pid>/exe or cwd, without the " (deleted)" a replaced install adds. */
function undeleted(link: string | null): string | null {
  return link === null ? null : link.replace(/ \(deleted\)$/, "");
}

/**
 * Which of this app's sidecars a process is, or null when it is not one.
 * Both the program and our identity must match, so the processes the API
 * starts for agent runs (they inherit its environment, secret included) and
 * anything they leave running are never taken for a leftover server:
 *
 * - API: the program is timely-api, and it carries our JWT secret or runs in
 *   our data folder (that one still matches after the secrets were
 *   regenerated, e.g. when the keyring changed).
 * - Web: Next names itself "next-server", runs as Electron's Node with an
 *   API_ORIGIN and PORT, and carries our JWT secret.
 *
 * The secret is random per user-data folder, so "Timely Dev" and the release
 * never match each other's servers.
 */
export function classifyProcess(info: ProcInfo, ours: { secret: string; dataDir: string }): OrphanKind | null {
  const has = (entry: string) => info.env.includes(entry);
  const hasKey = (key: string) => info.env.some((entry) => entry.startsWith(`${key}=`));
  const secret = Boolean(ours.secret) && has(`JWT_SECRET=${ours.secret}`);
  const exe = undeleted(info.exe);
  if (exe && path.basename(exe) === "timely-api") {
    return secret || (Boolean(ours.dataDir) && undeleted(info.cwd) === ours.dataDir) ? "api" : null;
  }
  if (secret && info.comm?.startsWith("next-server") && has("ELECTRON_RUN_AS_NODE=1") && hasKey("API_ORIGIN") && hasKey("PORT")) {
    return "web";
  }
  return null;
}

async function readProc(procRoot: string, name: string): Promise<ProcInfo | null> {
  const dir = path.join(procRoot, name);
  let env: string[];
  try {
    env = (await readFile(path.join(dir, "environ"), "latin1")).split("\0");
  } catch {
    return null;
  }
  const quiet = <T>(promise: Promise<T>) => promise.catch(() => null);
  const [exe, cwd, comm] = await Promise.all([
    quiet(readlink(path.join(dir, "exe"))),
    quiet(readlink(path.join(dir, "cwd"))),
    quiet(readFile(path.join(dir, "comm"), "latin1")),
  ]);
  return { env, exe, cwd, comm: comm?.trim() ?? null };
}

/**
 * This app's sidecars that are not children of `selfPid`, found through
 * /proc (Linux; elsewhere the list is empty). The single-instance lock means
 * no other live copy of this app uses our data folder, so a sidecar of ours
 * that is not our child is a leftover. /proc/<pid>/environ is only readable
 * for our own processes, so other users' are skipped. Async (the reads run
 * off the main thread): the caller bounds it with a timeout.
 */
export async function findOrphans(input: { secret: string; dataDir: string; selfPid: number; procRoot?: string }): Promise<Orphan[]> {
  const procRoot = input.procRoot ?? "/proc";
  if (!input.secret && !input.dataDir) return [];
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return [];
  }
  const orphans: Orphan[] = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === input.selfPid) continue;
    const info = await readProc(procRoot, name);
    if (!info) continue;
    const kind = classifyProcess(info, input);
    if (!kind) continue;
    if (parentPid(procRoot, name) === input.selfPid) continue;
    orphans.push({ pid, kind });
  }
  return orphans;
}

/** Field 4 of /proc/<pid>/stat; the command name (field 2) may hold spaces and parentheses. */
/**
 * Waits for an orphan scan for at most capMs: a /proc read can hang on a
 * process stuck in the kernel. onTimeout runs only when the cap wins, and the
 * timer is cleared when the scan finishes first.
 */
export async function scanWithCap(scan: Promise<Orphan[]>, capMs: number, onTimeout: () => void): Promise<Orphan[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<Orphan[]>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve([]);
    }, capMs);
  });
  try {
    return await Promise.race([scan, cap]);
  } finally {
    clearTimeout(timer);
  }
}

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
 * SIGTERM, then SIGKILL for whatever is still running after `graceMs`, then
 * up to `killWaitMs` more so the ports are free before they are checked.
 */
export async function stopOrphans(
  orphans: Orphan[],
  options: {
    graceMs?: number;
    killWaitMs?: number;
    log?: Logger;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    isAlive?: (pid: number) => boolean;
  } = {},
): Promise<void> {
  const log = options.log ?? silentLogger;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  const isAlive = options.isAlive ?? alive;
  const pending = new Set<number>();
  const waitFor = async (ms: number) => {
    const deadline = Date.now() + ms;
    while (pending.size > 0 && Date.now() < deadline) {
      for (const pid of pending) if (!isAlive(pid)) pending.delete(pid);
      if (pending.size > 0) await sleep(100);
    }
  };
  for (const orphan of orphans) {
    log.warn(`orphans: ${orphan.kind === "api" ? "an API" : "a web"} server from an earlier run is still running (pid ${orphan.pid}); stopping it`);
    try {
      kill(orphan.pid, "SIGTERM");
      pending.add(orphan.pid);
    } catch {
      // Already gone.
    }
  }
  await waitFor(options.graceMs ?? 5_000);
  for (const pid of pending) {
    log.warn(`orphans: pid ${pid} ignored SIGTERM; killing it`);
    try {
      kill(pid, "SIGKILL");
    } catch {
      pending.delete(pid);
    }
  }
  await waitFor(options.killWaitMs ?? 2_000);
}
