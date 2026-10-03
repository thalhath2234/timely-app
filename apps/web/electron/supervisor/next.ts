// The Next.js standalone server sidecar (moved out of main.ts). Electron-free:
// the node binary is Electron itself with ELECTRON_RUN_AS_NODE, passed in.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { waitForHttp } from "./api.ts";
import { waitForExit } from "./sidecar.ts";

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
  output?: (chunk: Buffer) => void;
};

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
    };
    if (this.options.runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(this.options.nodeBinary, [located.server], {
      cwd: located.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
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
