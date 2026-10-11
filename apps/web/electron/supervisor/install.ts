// What the running copy knows about its own install. Electron-free: main.ts
// passes in process.execPath, process.resourcesPath and the Next root.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { standaloneServerPath } from "./next.ts";

/**
 * A string that changes when the app's files on disk are replaced. A package
 * manager (pacman/AUR, or dpkg) swaps /opt/<pkg> under a running copy: the old
 * Next server keeps its build manifest in memory but serves `_next/static`
 * from disk, so its pages point at CSS and JS chunks that are gone (an
 * unstyled or white window). The Next BUILD_ID names the exact build; the
 * executable's inode/size/mtime covers a build without one. null when neither
 * can be read.
 */
export function installFingerprint(input: { execPath: string; nextRoot: string }): string | null {
  const parts: string[] = [];
  const located = standaloneServerPath(input.nextRoot);
  if (located) {
    try {
      parts.push(readFileSync(path.join(path.dirname(located.server), ".next", "BUILD_ID"), "utf8").trim());
    } catch {
      // No BUILD_ID (or mid-upgrade); the executable below still tells.
    }
  }
  try {
    const stat = statSync(input.execPath);
    parts.push(`${stat.ino}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
  } catch {
    // Missing for a moment while the package manager swaps it.
  }
  return parts.length ? parts.join("|") : null;
}

/**
 * True when a system package manager owns this install, so electron-updater
 * cannot update it: on Linux it only updates an AppImage ($APPIMAGE) or a
 * deb/rpm/pacman build that electron-builder marked with resources/package-type.
 * The AUR package extracts the AppImage into /opt, so it has neither, and
 * electron-updater would quietly answer "up to date" forever.
 */
export function isPackageManaged(input: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; resourcesPath: string }): boolean {
  if (input.platform !== "linux") return false;
  if (input.env.APPIMAGE) return false;
  return !existsSync(path.join(input.resourcesPath, "package-type"));
}
