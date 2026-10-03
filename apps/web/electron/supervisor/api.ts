// The Go API sidecar: environment per docs/desktop/README.md, health wait,
// graceful stop. Electron-free.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";
import { exe } from "./paths.ts";
import type { Secrets } from "./config.ts";
import type { ShellEnv } from "./shellEnv.ts";
import { sleep, waitForExit } from "./sidecar.ts";
import { PG_DATABASE, PG_USER } from "./postgres.ts";

export type ApiEnvInput = {
  apiPort: number;
  bind: string[];
  postgresPort: number;
  secrets: Secrets;
  dataDir: string;
  allowRegistration: boolean;
  shell: ShellEnv;
  /** Base environment; defaults to process.env. */
  base?: NodeJS.ProcessEnv;
};

/** Everything the API sidecar sees. Pure so the contract can be tested. */
export function buildApiEnv(input: ApiEnvInput): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...(input.base ?? process.env) };
  for (const key of Object.keys(base)) {
    // Electron-only switches must not leak into the Go process, and any
    // developer-shell DB_*/API_* values are replaced below anyway.
    if (key.startsWith("ELECTRON_") || key.startsWith("DB_") || key.startsWith("API_")) delete base[key];
  }
  return {
    ...base,
    PATH: input.shell.PATH,
    HOME: input.shell.HOME,
    API_PORT: String(input.apiPort),
    API_BIND: input.bind.join(","),
    DB_HOST: "127.0.0.1",
    DB_PORT: String(input.postgresPort),
    DB_USER: PG_USER,
    DB_PASSWORD: input.secrets.dbPassword,
    DB_NAME: PG_DATABASE,
    DB_SSLMODE: "disable",
    JWT_SECRET: input.secrets.jwtSecret,
    TIMELY_BACKUP_KEY: input.secrets.backupKey,
    TIMELY_DATA_DIR: input.dataDir,
    ALLOW_REGISTRATION: input.allowRegistration ? "true" : "false",
  };
}

export function apiBinds(tailscaleEnabled: boolean, tailscale: { ipv4?: string; ipv6?: string }): string[] {
  const bind = ["127.0.0.1"];
  if (tailscaleEnabled) {
    if (tailscale.ipv4) bind.push(tailscale.ipv4);
    if (tailscale.ipv6) bind.push(tailscale.ipv6);
  }
  return bind;
}

export type ApiOptions = {
  binaryDir: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  port: number;
  platform?: NodeJS.Platform;
  log?: Logger;
  output?: (chunk: Buffer) => void;
};

const API_GRACE_MS = 20_000;

export class ApiManager {
  private options: ApiOptions;
  private readonly platform: NodeJS.Platform;
  private readonly log: Logger;

  constructor(options: ApiOptions) {
    this.options = options;
    this.platform = options.platform ?? process.platform;
    this.log = options.log ?? silentLogger;
  }

  get binary() {
    return path.join(this.options.binaryDir, exe("timely-api", this.platform));
  }

  get localUrl() {
    return `http://127.0.0.1:${this.options.port}`;
  }

  /** Called before a restart when the environment (bind, registration) changed. */
  update(patch: Partial<Pick<ApiOptions, "env" | "port">>) {
    this.options = { ...this.options, ...patch };
  }

  launch(): ChildProcess {
    mkdirSync(this.options.dataDir, { recursive: true });
    const child = spawn(this.binary, [], {
      cwd: this.options.dataDir,
      env: this.options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    return child;
  }

  async ready(child: ChildProcess, timeoutMs = 60_000) {
    await waitForHttp(`${this.localUrl}/health`, timeoutMs, () => (child.exitCode !== null ? `API exited with code ${child.exitCode}` : null));
  }

  /** SIGTERM → 20 s (the API drains HTTP for 10 s and its workers for 8 s) → SIGKILL; `taskkill /t /f` on Windows. */
  async shutdown(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (this.platform === "win32") {
      child.kill();
      if (await waitForExit(child, API_GRACE_MS)) return;
      if (child.pid) await taskkill(child.pid);
      await waitForExit(child, 3_000);
      return;
    }
    child.kill("SIGTERM");
    if (await waitForExit(child, API_GRACE_MS)) return;
    this.log.warn("api: still running after SIGTERM; killing");
    child.kill("SIGKILL");
    await waitForExit(child, 3_000);
  }
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => resolve());
  });
}

/** Any response below 500 counts as up (a missing route is still a live server). */
export async function waitForHttp(url: string, timeoutMs: number, shouldAbort?: () => string | null, intervalMs = 400): Promise<void> {
  const started = Date.now();
  let lastError: string = "no response";
  while (Date.now() - started < timeoutMs) {
    const abort = shouldAbort?.();
    if (abort) throw new Error(abort);
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}
