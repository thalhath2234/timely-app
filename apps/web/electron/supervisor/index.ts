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
import { findOrphans, scanWithCap, setprivPath, stopOrphans } from "./lifetime.ts";
import { FileLog, createLogger, type Logger } from "./logger.ts";
import { NextManager } from "./next.ts";
import { userPaths, type ResourceDirs, type UserPaths } from "./paths.ts";
import { reconcilePorts, type PortSet } from "./ports.ts";
import { PostgresManager } from "./postgres.ts";
import { resolveShellEnv } from "./shellEnv.ts";
import { Sidecar, describe, sleep } from "./sidecar.ts";
import { detectTailscale, disableServe, enableServe, findTailscaleCli, serveRunner, urlFor, type ServeRunner, type TailscaleInfo } from "./tailscale.ts";

export type UpdateStatus = DesktopInstance["update"];
export type HttpsState = DesktopInstance["tailscale"]["https"];

export type Updater = {
  /** The status before any check (for example "managed"). */
  current(): UpdateStatus;
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
  /** Stop sidecars an earlier run left behind (lifetime.ts); on unless a test turns it off. */
  sweepOrphans?: boolean;
  /** Runs the tailscale CLI for Serve; defaults to the installed CLI. */
  tailscaleServe?: ServeRunner | null;
  fetch?: typeof fetch;
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

export const SETTING_KEYS: readonly DesktopSettingKey[] = ["tailscaleEnabled", "tailscaleHttps", "allowRegistration", "setupDone"];
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
const SWEEP_SCAN_CAP_MS = 3_000;
const TAILSCALE_REFRESH_MS = 5_000;
/** The first HTTPS request makes Tailscale fetch a certificate, which can take a while. */
const SERVE_VERIFY_ATTEMPTS = 3;
const SERVE_VERIFY_TIMEOUT_MS = 10_000;

export type SupervisorEvents = {
  change: [instance: DesktopInstance];
  boot: [progress: BootProgress];
};

/**
 * Builds the pairing payload: the Tailscale Serve HTTPS address when it is
 * on, then Tailscale URLs (IPv4, then IPv6), then loopback. `id` is the API's
 * instance id, which the phone pins. Pure so the ordering can be tested.
 */
export function pairingPayload(input: {
  name: string;
  id?: string;
  apiPort: number;
  tailscaleEnabled: boolean;
  tailscale: Pick<TailscaleInfo, "ipv4" | "ipv6">;
  httpsUrl?: string;
}): DesktopInstance["pairing"] {
  const urls = [...(input.httpsUrl ? [input.httpsUrl] : []), ...tailscaleUrls(input), urlFor("127.0.0.1", input.apiPort)];
  return input.id ? { v: 1, name: input.name, id: input.id, urls } : { v: 1, name: input.name, urls };
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
  private https: HttpsState = { status: "off" };
  private serveSync: Promise<void> = Promise.resolve();
  /** GET /health "instanceId" of the running API; goes in the pairing payload. */
  private instanceId: string | undefined;
  private postgresVersion: string | undefined;
  private update: UpdateStatus = { status: "idle" };
  private readonly platform: NodeJS.Platform;
  private readonly sidecarLogs: FileLog[] = [];
  /** setpriv the sidecars run under for a death signal (lifetime.ts), or null. */
  private setpriv: string | null = null;

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
    if (deps.updater) this.update = deps.updater.current();
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
    await this.stopLeftovers();
    try {
      const postgres = new PostgresManager({
        binDir: path.join(this.deps.resources.postgres, "bin"),
        libDir: path.join(this.deps.resources.postgres, "lib"),
        pgRoot: this.paths.pgRoot,
        pgData: this.paths.pgData,
        port: this.config.postgresPort,
        password: this.secrets.dbPassword,
        platform: this.platform,
        setpriv: this.setpriv,
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
        setpriv: this.setpriv,
        log: this.log,
        output: this.sidecarLog("api"),
      });
      await this.apiSidecar.start();
      await this.readInstanceId();
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
        setpriv: this.setpriv,
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
    void this.syncServe();
  }

  /**
   * Stops the API and web servers an earlier run left running (it crashed or
   * was killed before it could stop them), before ports are checked: a
   * leftover web server held its port and kept its memory forever. A
   * leftover postmaster is handled by PostgresManager.reclaimDataDir.
   */
  private async stopLeftovers() {
    this.setpriv = setprivPath(this.platform);
    if (this.platform === "linux") this.log.info(`lifetime: ${this.setpriv ? `death signal via ${this.setpriv}` : "setpriv --pdeathsig not available; relying on the stdin lifeline"}`);
    if (this.deps.sweepOrphans === false || !this.secrets) return;
    try {
      // Bounded: a /proc read can hang on a process stuck in the kernel.
      const orphans = await scanWithCap(
        findOrphans({ secret: this.secrets.jwtSecret, dataDir: this.paths.dataDir, selfPid: process.pid }),
        SWEEP_SCAN_CAP_MS,
        () => this.log.warn("orphans: scan timed out; skipping it"),
      );
      if (orphans.length) await stopOrphans(orphans, { log: this.log });
    } catch (error) {
      this.log.warn(`orphans: sweep failed: ${describe(error)}`);
    }
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

  private async readInstanceId() {
    try {
      const response = await (this.deps.fetch ?? fetch)(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const body = (await response.json()) as { instanceId?: unknown };
      if (typeof body.instanceId === "string" && body.instanceId) this.instanceId = body.instanceId;
    } catch (error) {
      this.log.warn(`api: could not read the instance id: ${describe(error)}`);
    }
  }

  /** Runs one Serve change at a time; each sees the settings as they are when it starts. */
  private syncServe(): Promise<void> {
    this.serveSync = this.serveSync.then(() => this.applyServe()).catch((error) => {
      this.https = { status: "error", error: describe(error) };
      this.log.warn(`tailscale serve: ${describe(error)}`);
      this.emitChange();
    });
    return this.serveSync;
  }

  private serveRun(): ServeRunner | null {
    if (this.deps.tailscaleServe !== undefined) return this.deps.tailscaleServe;
    const cli = findTailscaleCli(this.platform);
    return cli ? serveRunner(cli) : null;
  }

  private async applyServe() {
    const want = this.booted && this.config.tailscaleEnabled && this.config.tailscaleHttps;
    const run = this.serveRun();
    const dnsName = this.tailscale.dnsName;
    if (!want) {
      const previous = this.config.tailscaleServeTarget;
      if (previous && run && dnsName) {
        await disableServe(run, dnsName, previous);
        this.log.info(`tailscale serve: removed https://${dnsName}`);
        this.config.tailscaleServeTarget = undefined;
        this.save();
      }
      if (this.https.status !== "off") {
        this.https = { status: "off" };
        this.emitChange();
      }
      return;
    }
    if (!run) {
      this.https = { status: "error", error: "The tailscale command was not found on this computer." };
      this.emitChange();
      return;
    }
    if (!dnsName) {
      this.https = { status: "error", error: "Tailscale is not connected, or MagicDNS is off for your tailnet." };
      this.emitChange();
      return;
    }
    const url = `https://${dnsName}`;
    this.https = { status: "starting", url };
    this.emitChange();
    const target = this.apiUrl;
    const result = await enableServe(run, dnsName, target, this.config.tailscaleServeTarget);
    if (!result.ok) {
      this.log.warn(`tailscale serve: ${result.error}`);
      this.https = { status: "error", url, error: result.error };
      this.emitChange();
      return;
    }
    if (this.config.tailscaleServeTarget !== target) {
      this.config.tailscaleServeTarget = target;
      this.save();
    }
    const answered = await this.verifyServe(url);
    this.https = answered
      ? { status: "on", url }
      : {
          status: "error",
          url,
          error: `Tailscale Serve is set up, but ${url} did not answer as this Timely. Check that HTTPS certificates are on for your tailnet.`,
        };
    this.log.info(`tailscale serve: ${url} ${answered ? "answers" : "did not answer"}`);
    this.emitChange();
  }

  /** True once `${url}/health` answers with this API's instance id. */
  private async verifyServe(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < SERVE_VERIFY_ATTEMPTS; attempt += 1) {
      try {
        const response = await (this.deps.fetch ?? fetch)(`${url}/health`, { signal: AbortSignal.timeout(SERVE_VERIFY_TIMEOUT_MS) });
        const body = (await response.json()) as { instanceId?: unknown };
        if (!this.instanceId || body.instanceId === this.instanceId) return true;
        this.log.warn(`tailscale serve: ${url} answered as instance ${String(body.instanceId)}`);
        return false;
      } catch (error) {
        this.log.warn(`tailscale serve: ${url}/health: ${describe(error)}`);
      }
    }
    return false;
  }

  private emitChange() {
    this.emit("change", this.getInstance());
  }

  getInstance(): DesktopInstance {
    const name = this.tailscale.hostname || (this.deps.hostname ?? os.hostname)();
    const ts = { apiPort: this.config.apiPort, tailscaleEnabled: this.config.tailscaleEnabled, tailscale: this.tailscale };
    const httpsUrl = this.https.status === "on" ? this.https.url : undefined;
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
      tailscale: { ...this.tailscale, https: { ...this.https } },
      settings: {
        tailscaleEnabled: this.config.tailscaleEnabled,
        tailscaleHttps: this.config.tailscaleHttps,
        allowRegistration: this.config.allowRegistration,
        setupDone: this.config.setupDone,
      },
      pairing: pairingPayload({ name, id: this.instanceId, httpsUrl, ...ts }),
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
    if (changed && (key === "tailscaleEnabled" || key === "tailscaleHttps")) {
      await this.refreshTailscale(true);
      await this.syncServe();
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
    await this.readInstanceId();
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

  /**
   * Last resort when the process is exiting without shutdown() having
   * finished (Electron's process "exit"). Sync, so it cannot wait: each
   * sidecar gets the signal that stops it on its own (PostgreSQL's fast
   * shutdown carries on after we are gone).
   */
  killAllNow() {
    this.webSidecar.signalNow("SIGKILL");
    this.apiSidecar.signalNow("SIGTERM");
    this.postgresSidecar.signalNow("SIGINT");
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
