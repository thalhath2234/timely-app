// Orchestrates the hosted backend: Postgres → API → Next, settings, actions
// and the DesktopInstance snapshot the renderer sees. Electron-free: main.ts
// injects paths, safeStorage, shell/clipboard and the updater.
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesktopAction, DesktopActionResult, DesktopInstance, DesktopSettingKey } from "../../electron-env";
import { ApiManager, apiBinds, buildApiEnv } from "./api.ts";
import { copyDataDir, manualBackupName, preUpgradeBackupName, pruneBackups, KEEP_PRE_UPGRADE_BACKUPS, PRE_UPGRADE_PREFIX } from "./backup.ts";
import { ensureSecrets, loadConfig, saveConfig, type DesktopConfig, type Sealer, type Secrets } from "./config.ts";
import { FileLog, createLogger, type Logger } from "./logger.ts";
import { NextManager } from "./next.ts";
import { userPaths, type ResourceDirs, type UserPaths } from "./paths.ts";
import { reconcilePorts, type PortSet } from "./ports.ts";
import { PostgresManager } from "./postgres.ts";
import { resolveShellEnv } from "./shellEnv.ts";
import { Sidecar, describe, sleep } from "./sidecar.ts";
import { detectTailscale, urlFor, type TailscaleInfo } from "./tailscale.ts";

export type UpdateStatus = DesktopInstance["update"];

export type Updater = {
  check(): Promise<void>;
  install(): Promise<void>;
  onStatus(callback: (status: UpdateStatus) => void): void;
};

export type SupervisorDeps = {
  userData: string;
  resources: ResourceDirs;
  version: string;
  sealer: Sealer;
  /** Node-compatible binary for the Next server (Electron's execPath + ELECTRON_RUN_AS_NODE). */
  nodeBinary: string;
  runAsNode: boolean;
  openPath: (target: string) => Promise<string>;
  writeClipboard: (text: string) => void;
  updater?: Updater;
  /** Ports for a fresh config.json (local builds use their own set). */
  defaultPorts?: PortSet;
  platform?: NodeJS.Platform;
  /** Echo sidecar output to this process's stdout/stderr (dev). */
  echo?: boolean;
  hostname?: () => string;
};

export type BootStep = "postgres" | "api" | "web";
export type BootStepState = "pending" | "running" | "done" | "failed";
export type BootProgress = { step: BootStep; state: BootStepState; detail?: string };

export class BootError extends Error {
  readonly step: BootStep;

  constructor(step: BootStep, message: string) {
    super(message);
    this.name = "BootError";
    this.step = step;
  }
}

export const SETTING_KEYS: readonly DesktopSettingKey[] = ["tailscaleEnabled", "allowRegistration", "setupDone"];
export const ACTIONS: readonly DesktopAction[] = [
  "restartApi",
  "backupNow",
  "openDataFolder",
  "openLogs",
  "checkForUpdates",
  "installUpdate",
  "copyAddress",
];

const SHUTDOWN_CAP_MS = 15_000;
const TAILSCALE_REFRESH_MS = 5_000;

export type SupervisorEvents = {
  change: [instance: DesktopInstance];
  boot: [progress: BootProgress];
};

/**
 * Builds the pairing payload: Tailscale URLs first (IPv4, then IPv6), then
 * loopback. Pure so the ordering can be tested.
 */
export function pairingPayload(input: {
  name: string;
  apiPort: number;
  tailscaleEnabled: boolean;
  tailscale: Pick<TailscaleInfo, "ipv4" | "ipv6">;
}): { v: 1; name: string; urls: string[] } {
  return { v: 1, name: input.name, urls: [...tailscaleUrls(input), urlFor("127.0.0.1", input.apiPort)] };
}

export function tailscaleUrls(input: { apiPort: number; tailscaleEnabled: boolean; tailscale: Pick<TailscaleInfo, "ipv4" | "ipv6"> }): string[] {
  if (!input.tailscaleEnabled) return [];
  const urls: string[] = [];
  if (input.tailscale.ipv4) urls.push(urlFor(input.tailscale.ipv4, input.apiPort));
  if (input.tailscale.ipv6) urls.push(urlFor(input.tailscale.ipv6, input.apiPort));
  return urls;
}

export class Supervisor extends EventEmitter<SupervisorEvents> {
  readonly paths: UserPaths;
  readonly log: Logger;
  private config: DesktopConfig;
  private configExisted = false;
  private secrets: Secrets | null = null;
  private tailscale: TailscaleInfo = { installed: false, running: false };
  private tailscaleCheckedAt = 0;
  private postgresVersion: string | undefined;
  private update: UpdateStatus = { status: "idle" };
  private readonly platform: NodeJS.Platform;
  private readonly sidecarLogs: FileLog[] = [];

  private postgres: PostgresManager | null = null;
  private api: ApiManager | null = null;
  private next: NextManager | null = null;
  private readonly postgresSidecar: Sidecar;
  private readonly apiSidecar: Sidecar;
  private readonly webSidecar: Sidecar;
  private shuttingDown: Promise<void> | null = null;
  private booted = false;
  private readonly deps: SupervisorDeps;

  constructor(deps: SupervisorDeps) {
    super();
    this.deps = deps;
    this.platform = deps.platform ?? process.platform;
    this.paths = userPaths(deps.userData);
    for (const dir of [this.paths.logDir, this.paths.dataDir, this.paths.backupDir, this.paths.pgRoot]) {
      mkdirSync(dir, { recursive: true });
    }
    this.log = createLogger(path.join(this.paths.logDir, "supervisor.log"), {
      echo: deps.echo ? (chunk) => process.stderr.write(`[supervisor] ${chunk}`) : undefined,
    });
    const loaded = loadConfig(this.paths.configFile, deps.version, deps.defaultPorts);
    this.config = loaded.config;
    this.configExisted = loaded.existed;

    this.postgresSidecar = new Sidecar({
      name: "postgres",
      log: this.log,
      launch: async () => this.requirePostgres().launch(),
      ready: (child) => this.requirePostgres().ready(child),
      shutdown: (child) => this.requirePostgres().shutdown(child),
    });
    this.apiSidecar = new Sidecar({
      name: "api",
      log: this.log,
      launch: async () => this.requireApi().launch(),
      ready: (child) => this.requireApi().ready(child),
      shutdown: (child) => this.requireApi().shutdown(child),
    });
    this.webSidecar = new Sidecar({
      name: "web",
      log: this.log,
      launch: async () => this.requireNext().launch(),
      ready: (child) => this.requireNext().ready(child),
      shutdown: (child) => this.requireNext().shutdown(child),
    });
    for (const sidecar of [this.postgresSidecar, this.apiSidecar, this.webSidecar]) {
      sidecar.on("change", () => this.emitChange());
    }
    deps.updater?.onStatus((status) => {
      this.update = status;
      this.emitChange();
    });
  }

  private requirePostgres() {
    if (!this.postgres) throw new Error("PostgreSQL is not configured yet");
    return this.postgres;
  }
  private requireApi() {
    if (!this.api) throw new Error("API is not configured yet");
    return this.api;
  }
  private requireNext() {
    if (!this.next) throw new Error("Web server is not configured yet");
    return this.next;
  }

  private sidecarLog(name: string): (chunk: Buffer) => void {
    const file = new FileLog(path.join(this.paths.logDir, `${name}.log`), this.deps.echo ? (chunk) => process.stderr.write(`[${name}] ${chunk}`) : undefined);
    this.sidecarLogs.push(file);
    return (chunk) => file.write(chunk);
  }

  get webUrl(): string {
    return `http://127.0.0.1:${this.config.webPort}`;
  }

  get apiUrl(): string {
    return `http://127.0.0.1:${this.config.apiPort}`;
  }

  private progress(step: BootStep, state: BootStepState, detail?: string) {
    this.emit("boot", { step, state, detail });
  }

  private save() {
    saveConfig(this.paths.configFile, this.config);
  }

  /** Postgres → (pre-upgrade dump) → API → Next. Throws BootError on the failing step. */
  async boot(): Promise<void> {
    this.log.info(`boot: Timely ${this.deps.version} on ${this.platform}/${process.arch}; userData=${this.paths.userData}`);
    this.log.info(`boot: resources api=${this.deps.resources.api} postgres=${this.deps.resources.postgres} next=${this.deps.resources.next}`);
    this.progress("postgres", "pending");
    this.progress("api", "pending");
    this.progress("web", "pending");

    const sealed = ensureSecrets(this.config, this.deps.sealer);
    this.secrets = sealed.secrets;
    if (sealed.changed) {
      this.log.warn(`boot: generated secrets: ${sealed.regenerated.join(", ")}`);
      if (this.config.lostSecrets?.length) {
        this.log.warn(
          "boot: some stored secrets could not be unsealed (the OS keyring changed); the old sealed values are kept under lostSecrets in config.json. Older encrypted backups need the old backup key.",
        );
      }
      this.save();
    }

    // ---- Postgres --------------------------------------------------------
    this.progress("postgres", "running");
    try {
      const postgres = new PostgresManager({
        binDir: path.join(this.deps.resources.postgres, "bin"),
        libDir: path.join(this.deps.resources.postgres, "lib"),
        pgRoot: this.paths.pgRoot,
        pgData: this.paths.pgData,
        port: this.config.postgresPort,
        password: this.secrets.dbPassword,
        platform: this.platform,
        log: this.log,
        output: this.sidecarLog("postgres"),
      });
      const wasInitialized = postgres.initialized;
      await postgres.reclaimDataDir();
      await this.allocatePorts();
      postgres.setPort(this.config.postgresPort);
      this.postgresVersion = await postgres.version();
      const init = await postgres.ensureInitialized();
      if (init.initialized) this.log.info("postgres: initialized data directory");
      if (wasInitialized && sealed.regenerated.includes("dbPassword")) {
        this.log.warn("postgres: database password was regenerated; re-applying it to the timely role");
        await postgres.resetPassword(this.secrets.dbPassword);
      }
      this.postgres = postgres;
      // The server is stopped here, so a folder copy is a consistent backup.
      if (wasInitialized) this.preUpgradeBackup();
      await this.postgresSidecar.start();
      this.progress("postgres", "done");
    } catch (error) {
      const message = describe(error);
      this.progress("postgres", "failed", message);
      throw new BootError("postgres", message);
    }

    // ---- API --------------------------------------------------------------
    this.progress("api", "running");
    try {
      await this.refreshTailscale(true);
      const shell = await resolveShellEnv({ platform: this.platform });
      this.log.info(`api: PATH=${shell.PATH}`);
      this.api = new ApiManager({
        binaryDir: this.deps.resources.api,
        dataDir: this.paths.dataDir,
        env: this.apiEnv(shell),
        port: this.config.apiPort,
        platform: this.platform,
        log: this.log,
        output: this.sidecarLog("api"),
      });
      await this.apiSidecar.start();
      this.progress("api", "done");
    } catch (error) {
      const message = describe(error);
      this.progress("api", "failed", message);
      throw new BootError("api", message);
    }
    if (this.config.version !== this.deps.version) {
      this.config.version = this.deps.version;
      this.save();
    }

    // ---- Next -------------------------------------------------------------
    this.progress("web", "running");
    try {
      this.next = new NextManager({
        root: this.deps.resources.next,
        port: this.config.webPort,
        apiOrigin: this.apiUrl,
        jwtSecret: this.secrets.jwtSecret,
        nodeBinary: this.deps.nodeBinary,
        runAsNode: this.deps.runAsNode,
        output: this.sidecarLog("next"),
      });
      await this.webSidecar.start();
      this.progress("web", "done");
    } catch (error) {
      const message = describe(error);
      this.progress("web", "failed", message);
      throw new BootError("web", message);
    }
    this.booted = true;
    this.emitChange();
  }

  private async allocatePorts() {
    const { ports, changed } = await reconcilePorts(
      { postgresPort: this.config.postgresPort, apiPort: this.config.apiPort, webPort: this.config.webPort },
      { postgresOwned: false },
    );
    if (changed || !this.configExisted) {
      this.log.info(`ports: postgres=${ports.postgresPort} api=${ports.apiPort} web=${ports.webPort}`);
      Object.assign(this.config, ports);
      this.save();
      this.configExisted = true;
    }
  }

  private apiEnv(shell: { PATH: string; HOME: string }) {
    if (!this.secrets) throw new Error("secrets not loaded");
    return buildApiEnv({
      apiPort: this.config.apiPort,
      bind: apiBinds(this.config.tailscaleEnabled, this.tailscale),
      postgresPort: this.config.postgresPort,
      secrets: this.secrets,
      dataDir: this.paths.dataDir,
      allowRegistration: this.config.allowRegistration,
      shell,
    });
  }

  /** Folder copy of PGDATA before the first run of a new version; the server must be stopped. */
  private preUpgradeBackup() {
    const previous = this.config.version;
    if (!this.configExisted || !previous || previous === this.deps.version) return;
    this.log.info(`upgrade: ${previous} → ${this.deps.version}; copying the database folder first`);
    this.progress("postgres", "running", "Backing up before upgrade");
    const target = copyDataDir({
      pgData: this.paths.pgData,
      backupDir: this.paths.backupDir,
      name: preUpgradeBackupName(previous, this.deps.version),
      log: this.log,
    });
    this.log.info(`upgrade: backup written to ${target}`);
    const removed = pruneBackups(this.paths.backupDir, PRE_UPGRADE_PREFIX, KEEP_PRE_UPGRADE_BACKUPS);
    if (removed.length) this.log.info(`upgrade: pruned ${removed.join(", ")}`);
  }

  private async refreshTailscale(force = false) {
    if (!force && Date.now() - this.tailscaleCheckedAt < TAILSCALE_REFRESH_MS) return;
    this.tailscaleCheckedAt = Date.now();
    try {
      this.tailscale = await detectTailscale({ platform: this.platform });
    } catch (error) {
      this.log.warn(`tailscale: detection failed: ${describe(error)}`);
    }
  }

  private emitChange() {
    this.emit("change", this.getInstance());
  }

  getInstance(): DesktopInstance {
    const name = this.tailscale.hostname || (this.deps.hostname ?? os.hostname)();
    const ts = { apiPort: this.config.apiPort, tailscaleEnabled: this.config.tailscaleEnabled, tailscale: this.tailscale };
    return {
      version: this.deps.version,
      platform: this.platform,
      dataDir: this.paths.dataDir,
      logDir: this.paths.logDir,
      api: {
        ...this.apiSidecar.current,
        port: this.config.apiPort,
        localUrl: this.apiUrl,
        tailscaleUrls: tailscaleUrls(ts),
        bind: apiBinds(this.config.tailscaleEnabled, this.tailscale),
      },
      postgres: { ...this.postgresSidecar.current, port: this.config.postgresPort, version: this.postgresVersion },
      web: { ...this.webSidecar.current, port: this.config.webPort },
      tailscale: { ...this.tailscale },
      settings: {
        tailscaleEnabled: this.config.tailscaleEnabled,
        allowRegistration: this.config.allowRegistration,
        setupDone: this.config.setupDone,
      },
      pairing: pairingPayload({ name, ...ts }),
      update: { ...this.update },
    };
  }

  /** Snapshot with a fresh (throttled) Tailscale check; used by `instance:get`. */
  async getInstanceFresh(): Promise<DesktopInstance> {
    await this.refreshTailscale();
    return this.getInstance();
  }

  async setSetting(key: DesktopSettingKey, value: boolean): Promise<DesktopInstance> {
    if (!SETTING_KEYS.includes(key)) throw new Error(`Unknown setting: ${String(key)}`);
    if (typeof value !== "boolean") throw new Error("Setting values must be booleans");
    const changed = this.config[key] !== value;
    this.config[key] = value;
    this.save();
    this.log.info(`settings: ${key}=${value}`);
    if (changed && (key === "tailscaleEnabled" || key === "allowRegistration")) {
      await this.restartApi();
    }
    this.emitChange();
    return this.getInstance();
  }

  private async restartApi() {
    if (!this.api || !this.secrets) throw new Error("The API has not started yet");
    await this.refreshTailscale(true);
    const shell = await resolveShellEnv({ platform: this.platform });
    this.api.update({ env: this.apiEnv(shell) });
    await this.apiSidecar.start();
  }

  async action(name: DesktopAction): Promise<DesktopActionResult> {
    if (!ACTIONS.includes(name)) return { ok: false, error: `Unknown action: ${String(name)}` };
    try {
      switch (name) {
        case "restartApi":
          await this.restartApi();
          return { ok: true, message: "Server restarted" };
        case "backupNow": {
          // A cold copy needs the server stopped; the API reconnects on its
          // own once PostgreSQL is back, so only the database pauses.
          if (!this.postgresSidecar.isRunning || !this.postgres) return { ok: false, error: "The database is not running" };
          await this.postgresSidecar.stop();
          let target: string;
          try {
            target = copyDataDir({ pgData: this.paths.pgData, backupDir: this.paths.backupDir, name: manualBackupName(), log: this.log });
          } finally {
            await this.postgresSidecar.start();
          }
          return { ok: true, message: `Backup saved to ${target}. The database paused for a moment.` };
        }
        case "openDataFolder":
          return openResult(await this.deps.openPath(this.paths.userData));
        case "openLogs":
          return openResult(await this.deps.openPath(this.paths.logDir));
        case "checkForUpdates":
          if (!this.deps.updater) return { ok: false, error: "Updates are not available in this build" };
          await this.deps.updater.check();
          return { ok: true };
        case "installUpdate":
          if (!this.deps.updater) return { ok: false, error: "Updates are not available in this build" };
          await this.deps.updater.install();
          return { ok: true };
        case "copyAddress": {
          const url = this.getInstance().pairing.urls[0];
          this.deps.writeClipboard(url);
          return { ok: true, message: `Copied ${url}` };
        }
      }
    } catch (error) {
      const message = describe(error);
      this.log.error(`action ${name}: ${message}`);
      return { ok: false, error: message };
    }
    return { ok: false, error: `Unknown action: ${String(name)}` };
  }

  get isBooted() {
    return this.booted;
  }

  /** Next → API → Postgres, each awaited, capped at 15 s overall. */
  shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = (async () => {
      this.log.info("shutdown: stopping sidecars");
      const orderly = (async () => {
        await this.webSidecar.stop();
        await this.apiSidecar.stop();
        await this.postgresSidecar.stop();
      })();
      const capped = await Promise.race([orderly.then(() => true), sleep(SHUTDOWN_CAP_MS).then(() => false)]);
      if (!capped) {
        this.log.warn("shutdown: cap reached; killing remaining sidecars");
        for (const sidecar of [this.webSidecar, this.apiSidecar, this.postgresSidecar]) sidecar.forceKill();
      }
      this.postgres?.cleanupSocketDir();
      this.log.info("shutdown: done");
      for (const file of this.sidecarLogs) file.close();
      this.log.close();
    })();
    return this.shuttingDown;
  }
}

function openResult(error: string): DesktopActionResult {
  return error ? { ok: false, error } : { ok: true };
}
