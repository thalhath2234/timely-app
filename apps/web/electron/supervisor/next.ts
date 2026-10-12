// The Next.js standalone server sidecar (moved out of main.ts). Electron-free:
// the node binary is Electron itself with ELECTRON_RUN_AS_NODE, passed in.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { waitForHttp } from "./api.ts";
import { LIFELINE_ENV, withDeathSignal } from "./lifetime.ts";
import { waitForExit } from "./sidecar.ts";

/** electron/next-guard.cjs, as stage-next.mjs ships it next to the standalone output. */
export const GUARD_FILE = "timely-guard.cjs";

/**
 * Memory limits for the Next server. Electron's Node allows a 4 GB heap by
 * default and the server was seen at ~3 GB after days of use; it normally
 * sits at 150-300 MB. Past either limit it restarts (the supervisor brings it
 * back within a second) instead of growing until the system runs out.
 */
export const WEB_HEAP_LIMIT_MB = 1024;
export const WEB_RSS_LIMIT_MB = 1536;

export function standaloneServerPath(root: string): { root: string; server: string } | null {
  const nested = path.join(root, "apps", "web", "server.js");
  const flat = path.join(root, "server.js");
  if (existsSync(nested)) return { root, server: nested };
  if (existsSync(flat)) return { root, server: flat };
  return null;
}

export type NextOptions = {
  /** Staged standalone root (<resources>/next-server). */
  root: string;
  port: number;
  apiOrigin: string;
  jwtSecret: string;
  /** Node-compatible binary (Electron's execPath) and whether it needs ELECTRON_RUN_AS_NODE. */
  nodeBinary: string;
  runAsNode: boolean;
  /** setpriv to run under for a death signal (Linux; lifetime.ts setprivPath), or null. */
  setpriv?: string | null;
  output?: (chunk: Buffer) => void;
};

/** Node arguments for server.js: the heap cap, then the guard when it was staged. */
export function nodeArgs(root: string, server: string, guardExists: (file: string) => boolean = existsSync): string[] {
  const guard = path.join(root, GUARD_FILE);
  return [`--max-old-space-size=${WEB_HEAP_LIMIT_MB}`, ...(guardExists(guard) ? ["--require", guard] : []), server];
}

export class NextManager {
  private options: NextOptions;

  constructor(options: NextOptions) {
    this.options = options;
  }

  get localUrl() {
    return `http://127.0.0.1:${this.options.port}`;
  }

  update(patch: Partial<Pick<NextOptions, "apiOrigin" | "port">>) {
    this.options = { ...this.options, ...patch };
  }

  launch(): ChildProcess {
    const located = standaloneServerPath(this.options.root);
    if (!located) {
      throw new Error(`The bundled web app is missing (expected server.js under ${this.options.root}).`);
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(this.options.port),
      HOSTNAME: "127.0.0.1",
      API_ORIGIN: this.options.apiOrigin,
      JWT_SECRET: this.options.jwtSecret,
      [LIFELINE_ENV]: "stdin",
      TIMELY_WEB_RSS_LIMIT_MB: String(WEB_RSS_LIMIT_MB),
      TIMELY_WEB_HEAP_LIMIT_MB: String(WEB_HEAP_LIMIT_MB),
    };
    if (this.options.runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;
    const { command, args } = withDeathSignal(
      this.options.nodeBinary,
      nodeArgs(located.root, located.server),
      "KILL",
      this.options.setpriv ?? null,
    );
    // stdin is the lifeline: never written, it closes when this process ends.
    const child = spawn(command, args, {
      cwd: located.root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin?.on("error", () => {});
    child.stdout?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.options.output?.(chunk));
    return child;
  }

  async ready(child: ChildProcess, timeoutMs = 120_000) {
    await waitForHttp(`${this.localUrl}/calendar`, timeoutMs, () => (child.exitCode !== null ? `web server exited with code ${child.exitCode}` : null));
  }

  async shutdown(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    if (await waitForExit(child, 5_000)) return;
    child.kill("SIGKILL");
    await waitForExit(child, 2_000);
  }
}
