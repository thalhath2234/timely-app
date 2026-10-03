// Whole-database backups as folder copies of PGDATA taken while PostgreSQL is
// stopped. The bundled PostgreSQL (zonky) ships only initdb, pg_ctl and
// postgres, so pg_dump is not an option; a cold copy of the data directory is
// a complete, restorable backup (quit Timely, swap postgres/data, start).
// Electron-free.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";

export const KEEP_PRE_UPGRADE_BACKUPS = 3;
export const PRE_UPGRADE_PREFIX = "pre-upgrade-";
export const MANUAL_PREFIX = "manual-";

/** Files that belong to a running server, not to its data. */
const SKIP_ENTRIES = new Set(["postmaster.pid", "postmaster.opts"]);

export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace(/Z$/, "");
}

function safeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z.-]/g, "_") || "unknown";
}

export function preUpgradeBackupName(oldVersion: string, newVersion: string, date = new Date()): string {
  return `${PRE_UPGRADE_PREFIX}${safeVersion(oldVersion)}-${safeVersion(newVersion)}-${timestamp(date)}`;
}

export function manualBackupName(date = new Date()): string {
  return `${MANUAL_PREFIX}${timestamp(date)}`;
}

/**
 * Deletes all but the newest `keep` backup folders whose name starts with
 * `prefix` (by mtime, then name). Legacy `.dump` files from earlier builds
 * are treated the same way.
 */
export function pruneBackups(dir: string, prefix: string, keep: number): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  const removed: string[] = [];
  for (const entry of entries.slice(keep)) {
    rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

export type CopyOptions = {
  /** PGDATA; the server must be stopped. */
  pgData: string;
  backupDir: string;
  name: string;
  log?: Logger;
};

/**
 * Copies PGDATA to `<backupDir>/<name>`. Writes into a `.partial` folder
 * first and renames on success so an interrupted copy never looks complete.
 * Returns the final folder path.
 */
export function copyDataDir(options: CopyOptions): string {
  const log = options.log ?? silentLogger;
  if (!existsSync(path.join(options.pgData, "PG_VERSION"))) {
    throw new Error(`No database found at ${options.pgData}`);
  }
  if (existsSync(path.join(options.pgData, "postmaster.pid"))) {
    throw new Error("The database is still running; stop it before copying its folder");
  }
  mkdirSync(options.backupDir, { recursive: true });
  const target = path.join(options.backupDir, options.name);
  const partial = `${target}.partial`;
  rmSync(partial, { recursive: true, force: true });
  log.info(`backup: copying ${options.pgData} → ${target}`);
  try {
    cpSync(options.pgData, partial, {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) => !SKIP_ENTRIES.has(path.basename(source)),
    });
    rmSync(target, { recursive: true, force: true });
    // Rename instead of a second copy; same filesystem by construction.
    cpSync(partial, target, { recursive: true, preserveTimestamps: true });
    rmSync(partial, { recursive: true, force: true });
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  return target;
}
