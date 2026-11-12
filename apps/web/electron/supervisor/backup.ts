// Whole-database backups as folder copies of PGDATA taken while PostgreSQL is
// stopped. The bundled PostgreSQL (zonky) ships only initdb, pg_ctl and
// postgres, so pg_dump is not an option; a cold copy of the data directory is
// a complete, restorable backup (quit Timely, put back postgres/data and the
// agent homes together as restoreDataDir does, start; docs/desktop/README.md,
// "Restoring a folder backup").
//
// The agent's account homes (<data>/agent/accounts, plan 6.5 and 11.4) are
// copied beside it, into <name>.agent, while the API is stopped too (its
// agent workers are gone then, so state.db and its WAL are at rest). Only
// what the agent learned (with the skill ledger's blobs, which Undo reads) and
// the chat sessions (state.db) are kept; config.yaml, SOUL.md, sign-ins,
// scripts, caches, the workspace and sessions/ (Hermes' request dumps: a
// failed request's whole body, nothing a restore needs) are rebuilt or left
// out.
// restoreDataDir puts both back together. Electron-free.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Logger } from "./logger.ts";
import { silentLogger } from "./logger.ts";

export const KEEP_PRE_UPGRADE_BACKUPS = 3;
export const PRE_UPGRADE_PREFIX = "pre-upgrade-";
export const MANUAL_PREFIX = "manual-";

/** Suffix of the agent homes' folder beside a database backup folder. */
export const AGENT_SUFFIX = ".agent";

/** The parts of an agent home a folder backup keeps (besides state.db* and the ledger blobs). */
export const AGENT_HOME_PARTS = ["memories", "skills", "pending", ".timely"] as const;

/** The skill ledger's blobs: Undo and "what changed" of a learned skill read
 * them. Only this folder of `.curator_backups` (its snapshots are rebuilt). */
export const LEDGER_BLOBS = path.join(".curator_backups", "blobs");

/** An account home folder (agenthost.AccountDirName), never a staged restore or trash. */
const ACCOUNT_DIR = /^account-[0-9a-f]{24}$/;

function isAgentHomePart(name: string): boolean {
  return (AGENT_HOME_PARTS as readonly string[]).includes(name) || name === "state.db" || name.startsWith("state.db-");
}

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
    // A backup's agent homes go with it; they are not a backup of their own.
    .filter((name) => name.startsWith(prefix) && !name.endsWith(AGENT_SUFFIX) && !name.endsWith(".partial"))
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  const removed: string[] = [];
  for (const entry of entries.slice(keep)) {
    rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    rmSync(path.join(dir, entry.name + AGENT_SUFFIX), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

export type CopyOptions = {
  /** PGDATA; the server must be stopped. */
  pgData: string;
  backupDir: string;
  name: string;
  /**
   * `<data>/agent/accounts`; its homes are copied to `<name>.agent`. The API
   * must be stopped (no agent worker writes then). Skipped when missing.
   */
  agentAccounts?: string;
  log?: Logger;
};

/** `<data>/agent/accounts`: the API's TIMELY_DATA_DIR agent folder (agenthost.DefaultRoot). */
export function agentAccountsDir(dataDir: string): string {
  return path.join(dataDir, "agent", "accounts");
}

/** The agent homes' folder beside the backup folder `target`. */
export function agentBackupPath(target: string): string {
  return `${target}${AGENT_SUFFIX}`;
}

/** Copies a symlink-free tree, so a backup never follows a link out of the folder. */
function copyTree(source: string, target: string) {
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (entry) => !lstatSync(entry).isSymbolicLink(),
  });
}

function isRealDir(p: string): boolean {
  return existsSync(p) && !lstatSync(p).isSymbolicLink() && lstatSync(p).isDirectory();
}

function accountDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => ACCOUNT_DIR.test(name) && statSync(path.join(dir, name)).isDirectory());
}

/**
 * Copies the kept parts of every account home under `accounts` into
 * `target/<account dir>/`. Returns how many homes were copied.
 */
export function copyAgentHomes(accounts: string, target: string): number {
  mkdirSync(target, { recursive: true });
  const homes = accountDirs(accounts);
  for (const home of homes) {
    const into = path.join(target, home);
    mkdirSync(into, { recursive: true });
    for (const part of readdirSync(path.join(accounts, home))) {
      if (!isAgentHomePart(part)) continue;
      const from = path.join(accounts, home, part);
      if (lstatSync(from).isSymbolicLink()) continue;
      copyTree(from, path.join(into, part));
    }
    const blobs = path.join(accounts, home, LEDGER_BLOBS);
    if (isRealDir(path.join(accounts, home, ".curator_backups")) && isRealDir(blobs)) {
      copyTree(blobs, path.join(into, LEDGER_BLOBS));
    }
  }
  return homes.length;
}

/**
 * Copies PGDATA to `<backupDir>/<name>`, and the agent homes to
 * `<backupDir>/<name>.agent` when `agentAccounts` is given. Writes into
 * `.partial` folders first and renames on success so an interrupted copy
 * never looks complete. Returns the database folder's path.
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
  const agentTarget = agentBackupPath(target);
  const agentPartial = `${agentTarget}.partial`;
  const withAgent = options.agentAccounts !== undefined && existsSync(options.agentAccounts);
  rmSync(partial, { recursive: true, force: true });
  rmSync(agentPartial, { recursive: true, force: true });
  log.info(`backup: copying ${options.pgData} → ${target}`);
  try {
    cpSync(options.pgData, partial, {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) => !SKIP_ENTRIES.has(path.basename(source)),
    });
    if (withAgent) {
      const homes = copyAgentHomes(options.agentAccounts!, agentPartial);
      log.info(`backup: copied ${homes} agent home(s) → ${agentTarget}`);
    }
    rmSync(target, { recursive: true, force: true });
    rmSync(agentTarget, { recursive: true, force: true });
    // Rename instead of a second copy; same filesystem by construction.
    cpSync(partial, target, { recursive: true, preserveTimestamps: true });
    rmSync(partial, { recursive: true, force: true });
    if (withAgent) {
      cpSync(agentPartial, agentTarget, { recursive: true, preserveTimestamps: true });
      rmSync(agentPartial, { recursive: true, force: true });
    }
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    rmSync(agentPartial, { recursive: true, force: true });
    throw error;
  }
  return target;
}

export type RestoreOptions = {
  /** PGDATA to replace; the server must be stopped. */
  pgData: string;
  backupDir: string;
  name: string;
  /** `<data>/agent/accounts`; the API must be stopped. */
  agentAccounts?: string;
  log?: Logger;
};

export type RestoreResult = {
  /** The backup folder the database came from. */
  source: string;
  /** Agent homes put back; null when the backup has none (an older one). */
  agentHomes: number | null;
};

/**
 * Puts a folder backup back: the database folder replaces PGDATA, and, when
 * the backup has `<name>.agent`, every agent home gets the backup's kept
 * parts (a home the backup lacks loses its own, as its account's data is
 * the backup's now). A home's config, sign-ins and workspace stay; config
 * is rendered again before the next worker starts. An older backup without
 * agent homes leaves them as they are.
 */
export function restoreDataDir(options: RestoreOptions): RestoreResult {
  const log = options.log ?? silentLogger;
  const source = path.join(options.backupDir, options.name);
  if (!existsSync(path.join(source, "PG_VERSION"))) {
    throw new Error(`No database backup found at ${source}`);
  }
  if (existsSync(path.join(options.pgData, "postmaster.pid"))) {
    throw new Error("The database is still running; stop it before restoring its folder");
  }
  const incoming = `${options.pgData}.restoring`;
  const outgoing = `${options.pgData}.replaced`;
  rmSync(incoming, { recursive: true, force: true });
  rmSync(outgoing, { recursive: true, force: true });
  log.info(`restore: copying ${source} → ${options.pgData}`);
  try {
    cpSync(source, incoming, { recursive: true, preserveTimestamps: true });
  } catch (error) {
    rmSync(incoming, { recursive: true, force: true });
    throw error;
  }
  if (existsSync(options.pgData)) renameSync(options.pgData, outgoing);
  renameSync(incoming, options.pgData);
  rmSync(outgoing, { recursive: true, force: true });

  const agentSource = agentBackupPath(source);
  if (options.agentAccounts === undefined || !existsSync(agentSource)) {
    return { source, agentHomes: null };
  }
  const accounts = options.agentAccounts;
  mkdirSync(accounts, { recursive: true });
  const homes = new Set([...accountDirs(accounts), ...accountDirs(agentSource)]);
  for (const home of homes) {
    const live = path.join(accounts, home);
    mkdirSync(live, { recursive: true });
    for (const part of readdirSync(live)) {
      if (isAgentHomePart(part)) rmSync(path.join(live, part), { recursive: true, force: true });
    }
    rmSync(path.join(live, LEDGER_BLOBS), { recursive: true, force: true });
    const saved = path.join(agentSource, home);
    if (!existsSync(saved)) continue;
    for (const part of readdirSync(saved)) {
      if (isAgentHomePart(part)) copyTree(path.join(saved, part), path.join(live, part));
    }
    if (isRealDir(path.join(saved, LEDGER_BLOBS))) copyTree(path.join(saved, LEDGER_BLOBS), path.join(live, LEDGER_BLOBS));
  }
  log.info(`restore: put back ${homes.size} agent home(s) from ${agentSource}`);
  return { source, agentHomes: homes.size };
}
