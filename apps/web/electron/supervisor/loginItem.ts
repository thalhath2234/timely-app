// Start at login. Electron-free: main.ts injects the platform, env, execPath,
// the file system and Electron's login item API, so every platform's path is
// unit-tested on Linux (scripts/electron-login-item.test.mjs).
// Contract: docs/desktop/README.md ("Start at login").
//
// Windows: Electron's setLoginItemSettings writes a Run value named after the
// AppUserModelId; Task Manager › Startup apps turns it off through
// StartupApproved, which getLoginItemSettings reports as `enabled: false`.
// Linux: Electron does nothing there, so this writes an XDG autostart entry.
// macOS: Electron's own login item.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Passed by every login start; a hidden start keeps only the tray. */
export const HIDDEN_ARG = "--hidden";

export type LoginItemState = { supported: boolean; on: boolean; blockedBySystem: boolean };
export type LaunchItem = { name: string; path: string; args: string[]; enabled: boolean };
export type ElectronLogin = {
  get(o: { path?: string; args?: string[] }): { openAtLogin: boolean; launchItems?: LaunchItem[]; status?: string; wasOpenedAtLogin?: boolean };
  set(s: { openAtLogin: boolean; path?: string; args?: string[]; name?: string; enabled?: boolean }): void;
};
export type LoginItemFs = { read(file: string): string | null; write(file: string, text: string): void; remove(file: string): void; mkdir(dir: string): void };
export type LoginItemDeps = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  execPath: string;
  home: string;
  /** FLAVOR.name: "Timely" | "Timely Dev". */
  name: string;
  /** FLAVOR.appId: the Windows Run value name (= the AppUserModelId). */
  appId: string;
  /** FLAVOR.autostartFile: "timely.desktop" | "timely-dev.desktop". */
  autostartFile: string;
  /** app.isPackaged || env.TIMELY_DEV_LOGIN_ITEM === "1": a dev run never registers node_modules/electron. */
  enabled: boolean;
  electron: ElectronLogin;
  /** Defaults to node:fs. */
  fs?: LoginItemFs;
  log?: (message: string) => void;
};

const UNSUPPORTED: LoginItemState = { supported: false, on: false, blockedBySystem: false };
const CONTROL = /[\u0000-\u001f\u007f]/;

const nodeFs: LoginItemFs = {
  read(file) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  write: (file, text) => writeFileSync(file, text, "utf8"),
  remove: (file) => rmSync(file, { force: true }),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
};

/**
 * What a login start runs. On Linux, the AppImage file itself when this
 * process runs from inside it (APPDIR is its mount point): the mount is gone
 * after a reboot. An APPIMAGE inherited from a parent process is ignored.
 */
export function launchTarget(d: LoginItemDeps): string {
  if (d.platform !== "linux") return d.execPath;
  const { APPIMAGE, APPDIR } = d.env;
  if (APPIMAGE && APPDIR && path.posix.isAbsolute(APPIMAGE) && d.execPath.startsWith(`${APPDIR.replace(/\/+$/, "")}/`)) return APPIMAGE;
  return d.execPath;
}

/** $XDG_CONFIG_HOME/autostart/<file>; a relative XDG_CONFIG_HOME is ignored (the spec says so). */
export function autostartPath(d: LoginItemDeps): string {
  const xdg = d.env.XDG_CONFIG_HOME;
  const config = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(d.home, ".config");
  return path.posix.join(config, "autostart", d.autostartFile);
}

function refuseControl(value: string) {
  if (CONTROL.test(value)) throw new Error("login item: refusing a launch path with a control character");
}

/**
 * One Exec argument, per the Desktop Entry spec: double-quoted, with `"`,
 * `` ` ``, `$` and `\` escaped for the exec rules, then every backslash
 * escaped again because Exec is a string value; `%` doubled (field codes).
 */
export function quoteExec(value: string): string {
  refuseControl(value);
  const quoted = value.replace(/[\\"`$]/g, (c) => (c === "\\" ? "\\\\\\\\" : `\\\\${c}`)).replace(/%/g, "%%");
  return `"${quoted}"`;
}

/** A string-type value: backslashes escaped. */
export function escapeString(value: string): string {
  refuseControl(value);
  return value.replace(/\\/g, "\\\\");
}

export function desktopEntry(name: string, target: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${escapeString(name)}`,
    `Comment=Opens ${escapeString(name)} in the tray so your bots keep watching`,
    `TryExec=${escapeString(target)}`,
    `Exec=${quoteExec(target)} ${HIDDEN_ARG}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** The desktop turned the entry off: Hidden=true or X-GNOME-Autostart-enabled=false. */
function blockedEntry(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().toLowerCase();
    if ((key === "Hidden" && value === "true") || (key === "X-GNOME-Autostart-enabled" && value === "false")) return true;
  }
  return false;
}

/**
 * A turned-off entry pointed at `target`: only the [Desktop Entry] group's
 * TryExec and Exec lines change, so it stays off (Hidden /
 * X-GNOME-Autostart-enabled kept) but names the live file once turned back on.
 */
function repointEntry(text: string, target: string): string {
  let group = "";
  return text
    .split("\n")
    .map((line) => {
      const body = line.replace(/\r$/, "");
      const trimmed = body.trim();
      if (trimmed.startsWith("[")) group = trimmed;
      if (group !== "[Desktop Entry]") return line;
      const at = body.indexOf("=");
      const key = at < 0 ? "" : body.slice(0, at).trim();
      const cr = line.endsWith("\r") ? "\r" : "";
      if (key === "TryExec") return `TryExec=${escapeString(target)}${cr}`;
      if (key === "Exec") return `Exec=${quoteExec(target)} ${HIDDEN_ARG}${cr}`;
      return line;
    })
    .join("\n");
}

function samePath(a: string, b: string): boolean {
  const clean = (p: string) => p.trim().replace(/^"+|"+$/g, "").toLowerCase();
  return clean(a) === clean(b);
}

function supportedPlatform(d: LoginItemDeps): boolean {
  return d.enabled && (d.platform === "win32" || d.platform === "linux" || d.platform === "darwin");
}

function linuxTarget(d: LoginItemDeps, target?: string): string | null {
  const value = target ?? launchTarget(d);
  if (CONTROL.test(value)) {
    d.log?.("login item: refusing a launch path with a control character");
    return null;
  }
  return value;
}

function readLinux(d: LoginItemDeps, fs: LoginItemFs): LoginItemState {
  const text = fs.read(autostartPath(d));
  return { supported: true, on: text !== null, blockedBySystem: text !== null && blockedEntry(text) };
}

function windowsItem(d: LoginItemDeps): LaunchItem | undefined {
  const s = d.electron.get({ path: d.execPath, args: [HIDDEN_ARG] });
  return s.launchItems?.find((i) => i.name === d.appId);
}

function windowsState(d: LoginItemDeps, item: LaunchItem | undefined): LoginItemState {
  const on = !!item && samePath(item.path, d.execPath) && item.args.includes(HIDDEN_ARG);
  return { supported: true, on, blockedBySystem: !!item && !item.enabled };
}

function macState(d: LoginItemDeps): LoginItemState {
  const s = d.electron.get({});
  return { supported: true, on: s.openAtLogin, blockedBySystem: s.status === "requires-approval" };
}

/** The login item as the system has it now. Never writes. */
export function readLoginItem(d: LoginItemDeps): LoginItemState {
  if (!supportedPlatform(d)) return { ...UNSUPPORTED };
  if (d.platform === "win32") return windowsState(d, windowsItem(d));
  if (d.platform === "darwin") return macState(d);
  if (linuxTarget(d) === null) return { ...UNSUPPORTED };
  return readLinux(d, d.fs ?? nodeFs);
}

/**
 * Makes the system's login item match `want`. At boot (`userAction` false) it
 * only adds a missing entry or repairs one that points elsewhere, and never
 * re-enables one Windows or the desktop turned off; only the person's own
 * switch (`userAction`) does that. `target` replaces the launch path (the
 * AppImage's new name after an update); on a turned-off Linux entry only its
 * TryExec and Exec lines are rewritten.
 *
 * Windows: getLoginItemSettings lists only Run values whose program is this
 * executable, so a value named after the app id that points at another exe
 * (a reinstall into another folder) reads as missing; writing ours then also
 * resets its StartupApproved state to on (a known limit, docs/desktop/README.md).
 */
export function syncLoginItem(d: LoginItemDeps, want: boolean, userAction: boolean, target?: string): LoginItemState {
  if (!supportedPlatform(d)) return { ...UNSUPPORTED };

  if (d.platform === "win32") {
    // The path is always this executable, never a value from the environment.
    const item = windowsItem(d);
    const state = windowsState(d, item);
    if (want) {
      if (userAction || !item || (!state.on && !state.blockedBySystem)) {
        d.electron.set({ openAtLogin: true, path: d.execPath, args: [HIDDEN_ARG], name: d.appId, enabled: true });
        return windowsState(d, windowsItem(d));
      }
      return state;
    }
    if (item) {
      d.electron.set({ openAtLogin: false, path: d.execPath, args: [HIDDEN_ARG], name: d.appId });
      return windowsState(d, windowsItem(d));
    }
    return state;
  }

  if (d.platform === "darwin") {
    const state = macState(d);
    if (state.on !== want || userAction) {
      d.electron.set({ openAtLogin: want });
      return macState(d);
    }
    return state;
  }

  const launch = linuxTarget(d, target);
  if (launch === null) return { ...UNSUPPORTED };
  const fs = d.fs ?? nodeFs;
  const file = autostartPath(d);
  if (!want) {
    if (fs.read(file) !== null) fs.remove(file);
    return readLinux(d, fs);
  }
  const current = fs.read(file);
  const ours = desktopEntry(d.name, launch);
  if (current === null || userAction || (!blockedEntry(current) && current !== ours)) {
    fs.mkdir(path.posix.dirname(file));
    fs.write(file, ours);
  } else if (target !== undefined && blockedEntry(current)) {
    // The AppImage was renamed and the old file is gone: a turned-off entry
    // stays off, but must not keep naming a file that no longer exists.
    const repointed = repointEntry(current, launch);
    if (repointed !== current) fs.write(file, repointed);
  }
  return readLinux(d, fs);
}

/** A login start: --hidden, or macOS reporting it opened the app at login. */
export function startedHidden(argv: string[], platform: NodeJS.Platform, wasOpenedAtLogin: boolean): boolean {
  return argv.includes(HIDDEN_ARG) || (platform === "darwin" && wasOpenedAtLogin);
}
