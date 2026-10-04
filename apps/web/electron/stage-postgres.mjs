// Stage PostgreSQL for each target into .electron-postgres/<stageDir>/{bin,lib,share}.
//
// Source: zonky embedded-postgres jars from Maven Central (see targets.mjs).
// Each jar is a zip holding one postgres-<os>-<arch>.txz (xz tar) whose top
// level is bin/, lib/ and share/. The jar is cached in .cache/postgres/ and
// verified by SHA-256 before anything is extracted.
//
//   node electron/stage-postgres.mjs                 # host target
//   TIMELY_TARGETS=linux-x64,darwin-arm64 node electron/stage-postgres.mjs
//
// Note: zonky ships only initdb, pg_ctl and postgres. There is no pg_dump,
// pg_restore, psql or pg_isready in these archives.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  symlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { POSTGRES_VERSION, resolveTargets } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
export const cacheDir = path.join(webRoot, ".cache", "postgres");
export const stageRoot = path.join(webRoot, ".electron-postgres");
const marker = `.staged-${POSTGRES_VERSION}`;

// ---------------------------------------------------------------- download

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  console.log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
}

async function fetchJar(target) {
  const jar = path.join(cacheDir, target.zonkyJarName);
  if (!existsSync(jar)) await download(target.zonkyUrl, jar);
  const actual = sha256File(jar);
  if (actual !== target.zonkySha256) {
    rmSync(jar, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${target.zonkyJarName}\n  expected ${target.zonkySha256}\n  actual   ${actual}\n` +
        "The cached file was deleted; re-run to download again. If it keeps failing, the upstream artefact changed.",
    );
  }
  return jar;
}

// -------------------------------------------------------- zip extraction

function hasCommand(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return !r.error && r.status === 0;
}

/**
 * Minimal zip reader: returns the bytes of the entry whose name matches
 * `match`. Supports stored (0) and deflate (8) entries, no zip64, no
 * encryption — enough for a Maven jar.
 */
export function readZipEntry(zipPath, match) {
  const buf = readFileSync(zipPath);
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zipPath}: not a zip file (no end-of-central-directory)`);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const names = [];
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`${zipPath}: corrupt central directory at ${p}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name);
    if (match(name)) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`${zipPath}: corrupt local header for ${name}`);
      }
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = buf.subarray(start, start + compressedSize);
      if (method === 0) return { name, data };
      if (method === 8) return { name, data: inflateRawSync(data) };
      throw new Error(`${zipPath}: ${name} uses unsupported compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${zipPath}: no matching entry. Entries: ${names.join(", ")}`);
}

const isArchiveEntry = (name) => /^postgres-.*\.txz$/.test(name);

function extractInnerArchive(jar, target, dest) {
  const useUnzip = process.env.TIMELY_ZIP_READER !== "node" && hasCommand("unzip", ["-v"]);
  if (useUnzip) {
    const list = spawnSync("unzip", ["-Z1", jar], { encoding: "utf8" });
    const name = list.stdout.split(/\r?\n/).find(isArchiveEntry);
    if (name) {
      const r = spawnSync("unzip", ["-p", jar, name], { maxBuffer: 1024 ** 3 });
      if (r.status === 0) {
        writeFileSync(dest, r.stdout);
        return name;
      }
    }
    console.warn("unzip failed; falling back to the built-in zip reader");
  }
  const { name, data } = readZipEntry(jar, isArchiveEntry);
  writeFileSync(dest, data);
  if (name !== target.zonkyArchiveName) {
    console.warn(`expected ${target.zonkyArchiveName} inside the jar, found ${name}`);
  }
  return name;
}

// On Windows, prefer the system bsdtar. Under Git Bash (the release workflow's
// shell) PATH finds Git's GNU tar first, which reads "C:\..." as a remote
// host:path and fails with "Cannot connect to C: resolve failed".
function tarCommand() {
  if (process.platform === "win32") {
    const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (existsSync(systemTar)) return systemTar;
  }
  return "tar";
}

function untarXz(archive, dest) {
  // GNU tar and bsdtar (Windows 10+, macOS) both auto-detect xz on read.
  const tar = tarCommand();
  if (!hasCommand(tar, ["--version"])) {
    throw new Error(
      "tar was not found on PATH. Install it (Linux/macOS: tar + xz; Windows: tar.exe ships with Windows 10 1803+).",
    );
  }
  const r = spawnSync(tar, ["-xf", archive, "-C", dest], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `tar -xf ${path.basename(archive)} failed (exit ${r.status}).\n${r.stderr}\n` +
        "The archive is xz-compressed; make sure your tar can read xz (GNU tar needs the xz binary, bsdtar needs liblzma).",
    );
  }
}

// ---------------------------------------------------------------- pruning

const KEEP_BIN = new Set(["initdb", "pg_ctl", "postgres", "pg_dump", "pg_restore", "pg_isready", "psql"]);

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    visit(full, entry);
  }
}

/** Remove what the server never loads at runtime; keep anything in doubt. */
function prune(root, target) {
  const win = target.goos === "windows";
  const removed = [];
  const drop = (p) => {
    rmSync(p, { recursive: true, force: true });
    removed.push(path.relative(root, p));
  };

  const bin = path.join(root, "bin");
  for (const entry of readdirSync(bin, { withFileTypes: true })) {
    const base = entry.name.replace(/\.exe$/i, "");
    if (KEEP_BIN.has(base)) continue;
    // Windows keeps the runtime DLLs next to the executables; drop the
    // wxWidgets/pgAdmin leftovers and the test plugin, which postgres never loads.
    if (win && /\.dll$/i.test(entry.name) && !/^(wx.*|testplug)\.dll$/i.test(entry.name)) continue;
    drop(path.join(bin, entry.name));
  }

  const unusedLanguage = /^(plperl|plperlu|plpython3u?|pltcl|pltclu|.*_pl(perl|python3)u?|bool_plperl|jsonb_plperl|hstore_plperl|ltree_plpython3|hstore_plpython3|jsonb_plpython3)(\.|$)/;
  walk(root, (full, entry) => {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const name = entry.name;
    if (
      /\.(a|lib|la|pdb)$/i.test(name) || // static/import libraries, debug symbols
      /^(lib|lib\/postgresql)\/pgxs$/.test(rel) || // extension build makefiles
      /^include$/.test(rel) ||
      /^share(\/postgresql)?\/doc$/.test(rel) ||
      /^symbols$/.test(rel) ||
      (entry.isFile() && /^(lib(\/postgresql)?|share(\/postgresql)?\/extension)\//.test(rel) && unusedLanguage.test(name))
    ) {
      if (existsSync(full)) drop(full);
    }
  });
  return removed;
}

/**
 * The macOS archives ship libfoo.dylib, libfoo.1.dylib and libfoo.1.2.dylib
 * as three identical copies (170 MB of ICU data alone). Linux ships symlinks.
 * Turn byte-identical copies in lib/ into the Linux layout: the longest name
 * is the real file, the shorter names become relative symlinks to it.
 */
function dedupeLibraries(root) {
  const lib = path.join(root, "lib");
  const groups = new Map();
  for (const entry of readdirSync(lib, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(lib, entry.name);
    const key = `${statSync(full).size}:${sha256File(full)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.name);
  }
  let linked = 0;
  for (const names of groups.values()) {
    if (names.length < 2) continue;
    names.sort((a, b) => b.length - a.length || a.localeCompare(b));
    const [real, ...aliases] = names;
    for (const alias of aliases) {
      rmSync(path.join(lib, alias));
      symlinkSync(real, path.join(lib, alias));
      linked++;
    }
  }
  return linked;
}

function dirSize(dir) {
  let total = 0;
  walk(dir, (full, entry) => {
    if (entry.isFile()) total += statSync(full).size;
  });
  return total;
}

// ------------------------------------------------------------------- main

export async function stagePostgres(targets = resolveTargets()) {
  mkdirSync(cacheDir, { recursive: true });
  const results = [];
  for (const target of targets) {
    const out = path.join(stageRoot, target.stageDir);
    const markerFile = path.join(out, marker);
    if (existsSync(markerFile)) {
      console.log(`postgres ${POSTGRES_VERSION} already staged for ${target.key} → ${path.relative(webRoot, out)}`);
      results.push(out);
      continue;
    }

    const jar = await fetchJar(target);
    const tmp = await mkdtemp(path.join(os.tmpdir(), "timely-pg-"));
    try {
      const txz = path.join(tmp, "postgres.txz");
      const inner = extractInnerArchive(jar, target, txz);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      untarXz(txz, out);
      for (const required of ["bin", "lib", "share"]) {
        if (!existsSync(path.join(out, required))) {
          throw new Error(`${inner} did not contain ${required}/ at its top level`);
        }
      }
      const removed = prune(out, target);
      const linked = target.goos === "windows" ? 0 : dedupeLibraries(out);
      if (target.goos !== "windows") {
        for (const entry of readdirSync(path.join(out, "bin"))) {
          chmodSync(path.join(out, "bin", entry), 0o755);
        }
      }
      writeFileSync(markerFile, `${new Date().toISOString()}\n`);
      console.log(
        `staged postgres ${POSTGRES_VERSION} for ${target.key} → ${path.relative(webRoot, out)} ` +
          `(${(dirSize(out) / 1048576).toFixed(1)} MB, pruned ${removed.length} entries, ${linked} duplicate libraries linked)`,
      );
      results.push(out);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stagePostgres();
}
