// Generic restart-on-crash wrapper around a long-lived child process.
// Electron-free. The backoff policy is a pure function (planRestart) so it
// can be unit-tested without spawning anything.
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";

export type SidecarStatus = "stopped" | "starting" | "running" | "crashed";

export type SidecarState = {
  status: SidecarStatus;
  restarts: number;
  lastError?: string;
  pid?: number;
};

export type BackoffPolicy = {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
  /** Running at least this long resets the attempt counter. */
  healthyMs: number;
};

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1000, maxMs: 30_000, maxAttempts: 5, healthyMs: 60_000 };

export type BackoffState = {
  attempts: number;
  /** When the current/last run became healthy; null when it never did. */
  healthySince: number | null;
};

export const initialBackoff: BackoffState = { attempts: 0, healthySince: null };

/**
 * Decides whether to restart after a crash at `now`, and how long to wait.
 * Returns null when the attempt budget is exhausted.
 */
export function planRestart(
  state: BackoffState,
  now: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): { delayMs: number; state: BackoffState } | null {
  const attempts = state.healthySince !== null && now - state.healthySince >= policy.healthyMs ? 0 : state.attempts;
  if (attempts >= policy.maxAttempts) return null;
  const delayMs = Math.min(policy.baseMs * 2 ** attempts, policy.maxMs);
  return { delayMs, state: { attempts: attempts + 1, healthySince: null } };
}

export type SidecarOptions = {
  name: string;
  /** Spawns the child. May do async preparation first. */
  launch: () => Promise<ChildProcess>;
  /** Resolves when the child answers; rejects to mark the start as failed. */
  ready: (child: ChildProcess) => Promise<void>;
  /** Graceful stop; must resolve once the child has exited. */
  shutdown: (child: ChildProcess) => Promise<void>;
  policy?: BackoffPolicy;
  log?: Logger;
  now?: () => number;
};

export type SidecarEvents = {
  change: [state: SidecarState];
};

/**
 * Owns one child process. `start()` resolves when the child is healthy and
 * rejects when it cannot become healthy; later crashes are retried with
 * backoff and surfaced as state changes rather than exceptions.
 */
export class Sidecar extends EventEmitter<SidecarEvents> {
  readonly name: string;
  private child: ChildProcess | null = null;
  private state: SidecarState = { status: "stopped", restarts: 0 };
  private backoff: BackoffState = initialBackoff;
  private stopping = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly policy: BackoffPolicy;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly options: SidecarOptions;

  constructor(options: SidecarOptions) {
    super();
    this.options = options;
    this.name = options.name;
    this.policy = options.policy ?? DEFAULT_BACKOFF;
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? Date.now;
  }

  get current(): SidecarState {
    return { ...this.state };
  }

  get pid(): number | undefined {
    return this.child?.pid ?? undefined;
  }

  get isRunning(): boolean {
    return this.state.status === "running";
  }

  private setState(patch: Partial<SidecarState>) {
    this.state = { ...this.state, ...patch };
    this.emit("change", this.current);
  }

  /** Starts (or restarts) the child and waits for it to be healthy. */
  async start(): Promise<void> {
    this.clearRetry();
    this.stopping = false;
    if (this.child) await this.stop();
    this.stopping = false;
    await this.spawnAndWait();
  }

  private async spawnAndWait(): Promise<void> {
    this.setState({ status: "starting", lastError: undefined, pid: undefined });
    let child: ChildProcess;
    try {
      child = await this.options.launch();
    } catch (error) {
      const message = describe(error);
      this.log.error(`${this.name}: failed to launch: ${message}`);
      this.setState({ status: "crashed", lastError: message });
      throw error instanceof Error ? error : new Error(message);
    }
    this.child = child;
    this.setState({ pid: child.pid });
    this.log.info(`${this.name}: spawned pid ${child.pid}`);

    let exitedEarly: string | null = null;
    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null) => {
      exitedEarly = exitDescription(code, signal);
    };
    child.once("exit", onEarlyExit);
    child.on("error", (error) => this.log.error(`${this.name}: ${describe(error)}`));

    try {
      await Promise.race([
        this.options.ready(child),
        new Promise<void>((_, reject) => {
          if (exitedEarly) reject(new Error(exitedEarly));
          child.once("exit", (code, signal) => reject(new Error(exitDescription(code, signal))));
        }),
      ]);
    } catch (error) {
      const message = describe(error);
      this.log.error(`${this.name}: did not become ready: ${message}`);
      child.removeListener("exit", onEarlyExit);
      await this.terminate(child);
      this.child = null;
      this.setState({ status: "crashed", lastError: message, pid: undefined });
      throw error instanceof Error ? error : new Error(message);
    }
    child.removeListener("exit", onEarlyExit);
    this.backoff = { ...this.backoff, healthySince: this.now() };
    this.setState({ status: "running" });
    this.log.info(`${this.name}: ready`);
    child.once("exit", (code, signal) => this.onExit(child, code, signal));
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child !== child) return;
    this.child = null;
    if (this.stopping) {
      this.setState({ status: "stopped", pid: undefined });
      return;
    }
    const reason = exitDescription(code, signal);
    this.log.error(`${this.name}: crashed (${reason})`);
    this.scheduleRetry(reason);
  }

  /** Applies the backoff policy and either queues another spawn or gives up. */
  private scheduleRetry(reason: string) {
    if (this.stopping) return;
    const plan = planRestart(this.backoff, this.now(), this.policy);
    if (!plan) {
      this.setState({ status: "crashed", lastError: `${reason}; gave up after ${this.policy.maxAttempts} restarts`, pid: undefined });
      return;
    }
    this.backoff = plan.state;
    this.setState({ status: "crashed", lastError: reason, pid: undefined, restarts: plan.state.attempts });
    this.log.info(`${this.name}: restarting in ${plan.delayMs} ms (attempt ${plan.state.attempts}/${this.policy.maxAttempts})`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopping) return;
      this.spawnAndWait().catch((error) => this.scheduleRetry(describe(error)));
    }, plan.delayMs);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async terminate(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      await this.options.shutdown(child);
    } catch (error) {
      this.log.error(`${this.name}: shutdown error: ${describe(error)}`);
    }
  }

  /** Last resort when the graceful stop overran its budget. */
  forceKill() {
    this.stopping = true;
    this.clearRetry();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      this.log.warn(`${this.name}: force-killing pid ${child.pid}`);
      child.kill("SIGKILL");
    }
    this.child = null;
    this.setState({ status: "stopped", pid: undefined });
  }

  /** Stops the child and suppresses restarts. Resolves once it has exited. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRetry();
    const child = this.child;
    if (!child) {
      if (this.state.status !== "stopped") this.setState({ status: "stopped", pid: undefined });
      return;
    }
    this.log.info(`${this.name}: stopping pid ${child.pid}`);
    await this.terminate(child);
    this.child = null;
    this.backoff = initialBackoff;
    this.setState({ status: "stopped", pid: undefined, restarts: 0 });
  }
}

export function exitDescription(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `exited by signal ${signal}`;
  return `exited with code ${code ?? "unknown"}`;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves when the child exits, or after `timeoutMs` with false. */
export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
