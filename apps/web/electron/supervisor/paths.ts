// Where the sidecar binaries and user data live. Electron-free: main.ts
// passes in app.getPath("userData"), app.getAppPath() and process.resourcesPath.
// Layout contract: docs/desktop/README.md.
import { existsSync } from "node:fs";
import path from "node:path";

export type ResourceDirs = {
  /** Directory holding timely-api[.exe]. */
  api: string;
  /** Directory holding bin/, lib/, share/ of PostgreSQL. */
  postgres: string;
  /** Next.js standalone output; may be missing in local hosted runs. */
  next: string;
  /**
   * The agent runtime root (boot.py, python/, app/; plan 11.4). It may be
   * missing in a checkout that never ran stage-agent; agentRuntime() decides
   * whether the API gets it.
   */
  agent: string;
};

export type ResourceInputs = {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Packaged: `<resources>/{api,postgres,next-server,agent}`. `TIMELY_RESOURCES_DIR`
 * replaces `<resources>` for local testing. Unpackaged hosted runs fall back to
 * the staged `apps/web/.electron-{api,postgres,agent}/<platform>-<arch>` and
 * `apps/web/.electron-next`. With the override, Next and the agent fall back
 * to the staged folders when the override has none (electron/hosted.mjs links
 * only api, postgres and next-server).
 */
export function resolveResourceDirs(input: ResourceInputs): ResourceDirs {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const target = `${stageOs(platform)}-${arch}`;
  const staged = {
    api: path.join(input.appPath, ".electron-api", target),
    postgres: path.join(input.appPath, ".electron-postgres", target),
    next: path.join(input.appPath, ".electron-next"),
    agent: path.join(input.appPath, ".electron-agent", target),
  };
  const override = env.TIMELY_RESOURCES_DIR;
  if (override) {
    const next = path.join(override, "next-server");
    const agent = path.join(override, "agent");
    return {
      api: path.join(override, "api"),
      postgres: path.join(override, "postgres"),
      next: existsSync(next) ? next : staged.next,
      agent: existsSync(agent) ? agent : staged.agent,
    };
  }
  if (input.isPackaged) {
    return {
      api: path.join(input.resourcesPath, "api"),
      postgres: path.join(input.resourcesPath, "postgres"),
      next: path.join(input.resourcesPath, "next-server"),
      agent: path.join(input.resourcesPath, "agent"),
    };
  }
  return staged;
}

/**
 * The agent root to hand the API as TIMELY_AGENT_RUNTIME, or undefined when
 * `<dir>/boot.py` is missing (a build without the runtime, or an unstaged
 * checkout). The API then falls back to its own discovery (agenthost).
 */
export function agentRuntime(dir: string, exists: (file: string) => boolean = existsSync): string | undefined {
  return exists(path.join(dir, "boot.py")) ? dir : undefined;
}

/** electron-builder's ${os} name, which electron/targets.mjs uses for stage dirs. */
export function stageOs(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return platform;
}

export function exe(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

export type UserPaths = {
  userData: string;
  configFile: string;
  pgData: string;
  pgRoot: string;
  dataDir: string;
  backupDir: string;
  logDir: string;
};

export function userPaths(userData: string): UserPaths {
  return {
    userData,
    configFile: path.join(userData, "config.json"),
    pgRoot: path.join(userData, "postgres"),
    pgData: path.join(userData, "postgres", "data"),
    dataDir: path.join(userData, "data"),
    backupDir: path.join(userData, "backups"),
    logDir: path.join(userData, "logs"),
  };
}
