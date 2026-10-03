// Bundled PostgreSQL lifecycle: initdb on first run, a long-lived `postgres`
// child (never pg_ctl start, so the server dies with us), readiness probing,
// stale postmaster.pid handling and graceful stop. Electron-free.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";
import { exe } from "./paths.ts";
import { describe, sleep, waitForExit } from "./sidecar.ts";

export const PG_USER = "timely";
export const PG_DATABASE = "timely";
export const DB_CREATED_MARKER = ".db-created";

export type PostmasterPid = { pid: number; dataDir?: string; port?: number };

/** Parses PGDATA/postmaster.pid (line 1 pid, line 2 data dir, line 4 port). */
export function parsePostmasterPid(contents: string): PostmasterPid | null {
  const lines = contents.split(/\r?\n/);
  const pid = Number.parseInt(lines[0] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const port = Number.parseInt(lines[3] ?? "", 10);
  return { pid, dataDir: lines[1]?.trim() || undefined, port: Number.isInteger(port) && port > 0 ? port : undefined };
}

export function readPostmasterPid(pgData: string): PostmasterPid | null {
  const file = path.join(pgData, "postmaster.pid");
  if (!existsSync(file)) return null;
  try {
    return parsePostmasterPid(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type PidFileState = { kind: "none" } | { kind: "stale"; pid: number } | { kind: "alive"; pid: number; port?: number };

/**
 * Classifies the pid file. A stale file (its process is gone) is removed by
 * `removePidFile`; a live one belongs to a postmaster we started earlier and
 * lost track of, which the caller stops before starting a fresh server.
 */
export function classifyPidFile(entry: PostmasterPid | null, alive: (pid: number) => boolean = isPidAlive): PidFileState {
  if (!entry) return { kind: "none" };
  if (!alive(entry.pid)) return { kind: "stale", pid: entry.pid };
  return { kind: "alive", pid: entry.pid, port: entry.port };
}

export function removePidFile(pgData: string) {
  for (const name of ["postmaster.pid"]) {
    try {
      unlinkSync(path.join(pgData, name));
    } catch {
      // Already gone.
    }
  }
}

export type ProbeResult = "ready" | "starting" | "down";

/**
 * What pg_isready does, without the binary: open a connection, send a
 * StartupMessage and read the first reply. An authentication request (or any
 * error other than 57P03 "starting up") means the server accepts connections.
 */
export function probePostgres(host: string, port: number, timeoutMs = 1500): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish("down"));
    socket.on("error", () => finish("down"));
    socket.on("connect", () => {
      const body = Buffer.concat([
        Buffer.from([0, 3, 0, 0]),
        Buffer.from(`user\0${PG_USER}\0database\0postgres\0\0`, "latin1"),
      ]);
      const header = Buffer.alloc(4);
      header.writeInt32BE(body.length + 4);
      socket.write(Buffer.concat([header, body]));
    });
    let received = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const type = String.fromCharCode(received[0]);
      if (type === "R") finish("ready");
      else if (type === "E") finish(received.includes("57P03") ? "starting" : "ready");
      else finish("ready");
    });
    socket.on("close", () => finish("down"));
  });
}

export async function waitForPostgres(host: string, port: number, timeoutMs: number, shouldAbort?: () => string | null) {
  const started = Date.now();
  let last: ProbeResult = "down";
  while (Date.now() - started < timeoutMs) {
    const abort = shouldAbort?.();
    if (abort) throw new Error(abort);
    last = await probePostgres(host, port);
    if (last === "ready") return;
    await sleep(300);
  }
  throw new Error(`PostgreSQL did not accept connections on ${host}:${port} within ${Math.round(timeoutMs / 1000)} s (last state: ${last})`);
}

export type PostgresOptions = {
  binDir: string;
  libDir: string;
  pgRoot: string;
  pgData: string;
  port: number;
  password: string;
  platform?: NodeJS.Platform;
  log?: Logger;
  /** Receives server stdout/stderr lines. */
  output?: (chunk: Buffer) => void;
};

type RunResult = { code: number | null; stdout: string; stderr: string };

export class PostgresManager {
  private readonly platform: NodeJS.Platform;
  private readonly log: Logger;
  private socketDir: string | null = null;
  private options: PostgresOptions;

  constructor(options: PostgresOptions) {
    this.options = options;
    this.platform = options.platform ?? process.platform;
    this.log = options.log ?? silentLogger;
  }

  get port() {
    return this.options.port;
  }

  setPort(port: number) {
    this.options = { ...this.options, port };
  }

  bin(name: string): string {
    return path.join(this.options.binDir, exe(name, this.platform));
  }

  private env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    // zonky binaries carry an rpath, but be explicit for relocated bundles.
    const libVar = this.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    if (this.platform !== "win32") {
      env[libVar] = env[libVar] ? `${this.options.libDir}${path.delimiter}${env[libVar]}` : this.options.libDir;
    }
    delete env.PGHOST;
    delete env.PGPORT;
    delete env.PGUSER;
    delete env.PGPASSWORD;
    delete env.PGDATABASE;
    return env;
  }

  private run(binary: string, args: string[], input?: string, timeoutMs = 60_000): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        binary,
        args,
        { env: this.env(), timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error(`Missing PostgreSQL binary: ${binary}`));
            return;
          }
          resolve({ code: error ? ((error as { code?: number | string }).code as number | null) ?? 1 : 0, stdout, stderr });
        },
      );
      if (input !== undefined && child.stdin) {
        child.stdin.end(input);
      }
    });
  }

  async version(): Promise<string | undefined> {
    try {
      const result = await this.run(this.bin("postgres"), ["--version"], undefined, 10_000);
      const match = result.stdout.match(/(\d+(?:\.\d+)*)/);
      return match?.[1] ?? (result.stdout.trim() || undefined);
    } catch {
      return undefined;
    }
  }

  get initialized(): boolean {
    return existsSync(path.join(this.options.pgData, "PG_VERSION"));
  }

  /** initdb on first run, then the `timely` database in single-user mode. */
  async ensureInitialized(): Promise<{ initialized: boolean; createdDatabase: boolean }> {
    let initialized = false;
    if (!this.initialized) {
      this.log.info("postgres: initdb (first run)");
      mkdirSync(this.options.pgRoot, { recursive: true });
      rmSync(this.options.pgData, { recursive: true, force: true });
      const pwDir = mkdtempSync(path.join(os.tmpdir(), "timely-pw-"));
      const pwFile = path.join(pwDir, "pw");
      try {
        writeFileSync(pwFile, `${this.options.password}\n`, { mode: 0o600 });
        const result = await this.run(
          this.bin("initdb"),
          ["-D", this.options.pgData, "-U", PG_USER, "--auth=scram-sha-256", `--pwfile=${pwFile}`, "-E", "UTF8", "--locale=C"],
          undefined,
          180_000,
        );
        if (result.code !== 0) {
          rmSync(this.options.pgData, { recursive: true, force: true });
          throw new Error(`initdb failed (${result.code}): ${tail(result.stderr || result.stdout)}`);
        }
      } finally {
        rmSync(pwDir, { recursive: true, force: true });
      }
      initialized = true;
    }
    const createdDatabase = await this.ensureDatabase();
    return { initialized, createdDatabase };
  }

  private get markerFile() {
    return path.join(this.options.pgRoot, DB_CREATED_MARKER);
  }

  /** CREATE DATABASE via `postgres --single` before the server starts; idempotent. */
  private async ensureDatabase(): Promise<boolean> {
    if (existsSync(this.markerFile)) return false;
    this.log.info(`postgres: creating database ${PG_DATABASE} (single-user mode)`);
    const result = await this.run(
      this.bin("postgres"),
      ["--single", "-D", this.options.pgData, "-c", "unix_socket_directories=", "postgres"],
      `CREATE DATABASE ${PG_DATABASE} TEMPLATE template0 ENCODING 'UTF8';\n`,
      120_000,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    const failed = result.code !== 0 || (/ERROR:/.test(output) && !/already exists/.test(output));
    if (failed) {
      throw new Error(`Could not create the ${PG_DATABASE} database: ${tail(output)}`);
    }
    writeFileSync(this.markerFile, `${new Date().toISOString()}\n`);
    return true;
  }

  /** Re-applies the role password in single-user mode (keyring loss recovery). */
  async resetPassword(password: string) {
    const escaped = password.replace(/'/g, "''");
    const result = await this.run(
      this.bin("postgres"),
      ["--single", "-D", this.options.pgData, "-c", "unix_socket_directories=", "postgres"],
      `ALTER ROLE ${PG_USER} PASSWORD '${escaped}';\n`,
      60_000,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 || /ERROR:/.test(output)) {
      throw new Error(`Could not reset the database password: ${tail(output)}`);
    }
  }

  /**
   * Deals with a leftover postmaster.pid: removes a stale one, stops a live
   * orphan from an earlier run of ours (its data dir is this one).
   */
  async reclaimDataDir(alive: (pid: number) => boolean = isPidAlive): Promise<PidFileState> {
    const state = classifyPidFile(readPostmasterPid(this.options.pgData), alive);
    if (state.kind === "stale") {
      this.log.warn(`postgres: removing stale postmaster.pid (pid ${state.pid} is gone)`);
      removePidFile(this.options.pgData);
    } else if (state.kind === "alive") {
      this.log.warn(`postgres: a postmaster from an earlier run is still alive (pid ${state.pid}); stopping it`);
      await this.stopOrphan(state.pid);
      if (readPostmasterPid(this.options.pgData)) {
        throw new Error(`A PostgreSQL server (pid ${state.pid}) still holds ${this.options.pgData}. Stop it and try again.`);
      }
    }
    return state;
  }

  private async stopOrphan(pid: number) {
    if (this.platform === "win32") {
      await this.run(this.bin("pg_ctl"), ["stop", "-m", "fast", "-w", "-t", "15", "-D", this.options.pgData], undefined, 20_000);
      return;
    }
    for (const [signal, waitMs] of [["SIGTERM", 10_000], ["SIGINT", 5_000], ["SIGKILL", 2_000]] as const) {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        if (!isPidAlive(pid)) {
          removePidFile(this.options.pgData);
          return;
        }
        await sleep(200);
      }
    }
  }

  private prepareSocketDir(): string {
    if (this.platform === "win32") return "";
    if (this.socketDir && existsSync(this.socketDir)) return this.socketDir;
    // Unix socket paths are limited to ~100 bytes; keep it short and private.
    this.socketDir = mkdtempSync(path.join(os.tmpdir(), "timely-pg-"));
    return this.socketDir;
  }

  /** Spawns the server as our child. The caller waits with `ready()`. */
  launch(): ChildProcess {
    const socketDir = this.prepareSocketDir();
    const args = [
      "-D",
      this.options.pgData,
      "-p",
      String(this.options.port),
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      `unix_socket_directories=${socketDir}`,
      "-c",
      "log_destination=stderr",
      "-c",
      "logging_collector=off",
      "-c",
      "log_timezone=UTC",
    ];
    const child = spawn(this.bin("postgres"), args, {
      env: this.env(),
      cwd: this.options.pgRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: false,
    });
    child.stdout?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    return child;
  }

  async ready(child: ChildProcess, timeoutMs = 60_000) {
    await waitForPostgres("127.0.0.1", this.options.port, timeoutMs, () =>
      child.exitCode !== null ? `postgres exited with code ${child.exitCode}` : null,
    );
  }

  /** SIGINT (fast: open sessions are rolled back, a clean checkpoint is written) → SIGQUIT → SIGKILL; pg_ctl on Windows. */
  async shutdown(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (this.platform === "win32") {
      try {
        await this.run(this.bin("pg_ctl"), ["stop", "-m", "fast", "-w", "-t", "10", "-D", this.options.pgData], undefined, 15_000);
      } catch (error) {
        this.log.warn(`postgres: pg_ctl stop failed: ${describe(error)}`);
      }
      if (!(await waitForExit(child, 2_000))) child.kill();
      await waitForExit(child, 3_000);
    } else {
      // Smart shutdown (SIGTERM) would wait for the API's idle pool
      // connections to close and always hit its timeout; fast is the mode
      // pg_ctl uses by default and what a backup or quit needs.
      for (const [signal, waitMs] of [["SIGINT", 10_000], ["SIGQUIT", 5_000], ["SIGKILL", 3_000]] as const) {
        child.kill(signal);
        if (await waitForExit(child, waitMs)) break;
        this.log.warn(`postgres: still running after ${signal}`);
      }
    }
    this.cleanupSocketDir();
  }

  cleanupSocketDir() {
    if (!this.socketDir) return;
    rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }
}

function tail(text: string, lines = 6): string {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}
