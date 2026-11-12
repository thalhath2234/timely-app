// Helpers for stage-agent.mjs and smoke-agent.mjs (plan 11.4, phase 3b work
// packages "stage-agent"). Only node: builtins, so CI runners and the Docker
// build stage run them without `pnpm install`. Each helper takes its inputs
// as arguments so scripts/stage-agent.test.mjs can drive it on a fixture.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Longest path allowed relative to the agent root, counted after compileall (plan 11.4). */
export const MAX_PATH_CHARS = 150;

/**
 * Bumped when what steps 2-4 produce changes in a way the marker does not
 * already cover (the trim rules and the install flags are hashed themselves),
 * so a stage made by an older script is not reused through its marker.
 * 2: the libpython trim (5afaf5eb) and the trim rules and install flags in the hash.
 */
export const STAGE_FORMAT = 2;

/** `uv pip install` flags for app/site-packages (stage-agent.mjs adds --python, --target and -r). */
export const PIP_INSTALL_FLAGS = ["--no-deps", "--require-hashes", "--no-build", "--link-mode", "copy"];

/**
 * The oldest glibc the Linux runtime runs on. Left to itself uv picks the
 * newest manylinux wheel the staging host's glibc allows (cryptography's
 * manylinux_2_34 on ubuntu-latest), which would make the floor depend on the
 * build machine and fail only when a feature imports that module. 2.28 is
 * Debian 10, RHEL 8 and Ubuntu 20.04 (docs/desktop/README.md).
 */
export const LINUX_GLIBC_FLOOR = "2.28";
const PYTHON_PLATFORM = {
  "linux-x64": `x86_64-manylinux_${LINUX_GLIBC_FLOOR.replace(".", "_")}`,
  "linux-arm64": `aarch64-manylinux_${LINUX_GLIBC_FLOOR.replace(".", "_")}`,
};

/** PIP_INSTALL_FLAGS plus, on Linux, `--python-platform` for the LINUX_GLIBC_FLOOR wheels. */
export function pipInstallFlags(targetKey) {
  const platform = PYTHON_PLATFORM[targetKey];
  return platform ? [...PIP_INSTALL_FLAGS, "--python-platform", platform] : PIP_INSTALL_FLAGS;
}

/** Skill folders and files Hermes' own seed code skips (timely_agent/seed.py IGNORED_NAMES). */
export const IGNORED_NAMES = new Set(["__pycache__", ".DS_Store", ".git"]);

/** Hermes never lets these be disabled (timely_agent/seed.py ESSENTIAL_SKILLS). */
export const ESSENTIAL_SKILLS = new Set(["hermes-agent"]);

/** What `sys.platform` and `platform.machine()` report for each target key. */
export const EXPECTED_PLATFORM = {
  "linux-x64": ["linux", "x86_64"],
  "linux-arm64": ["linux", "aarch64"],
  "darwin-x64": ["darwin", "x86_64"],
  "darwin-arm64": ["darwin", "arm64"],
  "win32-x64": ["win32", "AMD64"],
  "win32-arm64": ["win32", "ARM64"],
};

const toPosix = (p) => p.split(path.sep).join("/");

// ------------------------------------------------------------ inputs

/** `NAME ?= value` from the Makefile, parsed the way ci.yml's agent-windows job does. */
export function makefileVar(text, name) {
  const m = new RegExp(`^${name}\\s*\\??=\\s*(\\S+)`, "m").exec(text);
  if (!m) throw new Error(`the Makefile does not set ${name}`);
  return m[1];
}

/**
 * The interpreter pin for `key` in Hermes' pm/lock.json:
 * packages.python.{version, artifacts[key]: {url, sha256}}. The lock's
 * version must be the Makefile's AGENT_PYTHON_VERSION (plus a build tag).
 */
export function pythonArtifact(lock, key, expectedVersion) {
  const python = lock?.packages?.python;
  if (!python || typeof python.version !== "string" || typeof python.artifacts !== "object") {
    throw new Error("apps/agent/hermes/pm/lock.json has no packages.python {version, artifacts}");
  }
  const { version } = python;
  if (version !== expectedVersion && !version.startsWith(`${expectedVersion}+`)) {
    throw new Error(
      `pm/lock.json pins Python ${version} but the Makefile's AGENT_PYTHON_VERSION is ${expectedVersion}. ` +
        "Set AGENT_PYTHON_VERSION to the lock's version (without the +build tag) after a Hermes sync.",
    );
  }
  const artifact = python.artifacts[key];
  if (!artifact || typeof artifact.url !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) {
    throw new Error(
      `pm/lock.json has no Python artifact for ${key} (it has ${Object.keys(python.artifacts).join(", ")})`,
    );
  }
  return { version, url: artifact.url, sha256: artifact.sha256, entry: { version, ...artifact } };
}

/** Lines of .hermes-sync/extras.txt without comments or blanks (the Makefile's agent-install parsing). */
export function parseExtras(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

/** Why a fetch failed: undici's "fetch failed" with its cause (DNS, reset, timeout) and that cause's code. */
function fetchFailure(err) {
  const cause = err?.cause;
  const detail = cause ? `${cause.message ?? cause}${cause.code && !String(cause.message).includes(cause.code) ? ` (${cause.code})` : ""}` : "";
  return detail ? `${err.message}: ${detail}` : String(err?.message ?? err);
}

/**
 * Download `url` to `dest` (through `dest`.part, renamed once complete). A
 * network error, a body cut off mid-stream, a 5xx or a 429 is retried
 * (`attempts` in all, `delayMs` doubling between them); any other status
 * fails at once. The thrown message names the URL, every attempt's failure
 * and the network error's cause. Callers check what they download (sha256),
 * so a retry never changes what is accepted.
 */
export async function downloadFile(url, dest, { attempts = 3, delayMs = 2000, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const failures = [];
  const tmp = `${dest}.part`;
  mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retry = true;
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      if (res.ok && res.body) {
        await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
        rmSync(dest, { force: true });
        renameSync(tmp, dest);
        return;
      }
      failures.push(`HTTP ${res.status} ${res.statusText ?? ""}`.trim());
      retry = res.status >= 500 || res.status === 429;
      await res.body?.cancel?.().catch(() => {});
    } catch (err) {
      failures.push(fetchFailure(err));
    }
    rmSync(tmp, { force: true });
    if (!retry || attempt === attempts) break;
    await sleep(delayMs * 2 ** (attempt - 1));
  }
  throw new Error(`GET ${url} failed after ${failures.length} attempt(s): ${failures.join("; ")}`);
}

/**
 * Scratch folder for prepare and smoke runs of one checkout:
 * ~/.cache/timely-agent-stage/<12 hex of the checkout path>. Never under /tmp
 * (a small tmpfs on some machines), and per checkout so `--clean` in one
 * worktree never deletes another worktree's in-flight run.
 */
export function scratchRootFor(repoRoot, home = os.homedir()) {
  const id = createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 12);
  return path.join(home, ".cache", "timely-agent-stage", id);
}

/**
 * Targets the agent runtime cannot be staged for, with the reason. The stage
 * installs wheels only (--no-build), and Hermes v0.23.0's uv.lock pins
 * cryptography 50.0.2, which has no macOS x86_64 wheel: an Intel Mac build
 * would fail late inside uv pip install.
 */
export const UNSTAGEABLE_TARGETS = {
  "darwin-x64":
    "Intel Macs cannot ship the agent runtime: cryptography 50.0.2 (Hermes v0.23.0's uv.lock) has no macOS x86_64 wheel " +
    "and the stage installs wheels only. Build on Apple silicon (darwin-arm64).",
};

/**
 * Every key must be the host and stageable: checked for the whole list before
 * anything is staged or built, so a multi-target run fails up front instead of
 * after staging the host target.
 */
export function assertHostTargets(keys, hostKey) {
  const others = keys.filter((key) => key !== hostKey);
  if (others.length) {
    try {
      assertHostTarget(others[0], hostKey);
    } catch (err) {
      const list = others.length > 1 ? ` (and ${others.slice(1).join(", ")})` : "";
      throw new Error(`${err.message}${list} Nothing was staged.`);
    }
  }
  const unstageable = keys.find((key) => UNSTAGEABLE_TARGETS[key]);
  if (unstageable) throw new Error(`stage-agent: cannot stage ${unstageable}. ${UNSTAGEABLE_TARGETS[unstageable]} Nothing was staged.`);
}

/** Native modules are installed for the running interpreter, so a target must be the host. */
export function assertHostTarget(key, hostKey) {
  if (key === hostKey) return;
  const [os, arch] = key.split("-");
  const runner = { win32: "Windows", linux: "Linux", darwin: "macOS" }[os] ?? os;
  throw new Error(
    `stage-agent: cannot stage ${key} on ${hostKey}. The agent runtime installs native modules for the ` +
      `interpreter that runs, so it is staged on its own OS and architecture: stage ${key} on a ${runner} ${arch} ` +
      "runner (CI agent-stage or the release desktop job).",
  );
}

/**
 * sha256 naming the `.staged-<hash>` marker: everything steps 2-4 depend on,
 * including the trim rules and the install flags, so changing either restages.
 */
export function markerHash({ pythonEntry, uvLock, extras, target, trim = TRIM.map(String), siteTrim = SITE_TRIM.map(String), install = pipInstallFlags(target) }) {
  const h = createHash("sha256");
  h.update(JSON.stringify({ format: STAGE_FORMAT, python: pythonEntry, extras, target, trim, siteTrim, install }));
  h.update("\0");
  h.update(uvLock);
  return h.digest("hex").slice(0, 16);
}

// ------------------------------------------------------------ walking

/** Depth-first walk without following symlinks; `visit(full, rel, dirent)` returns false to skip a folder. */
export function walk(root, visit, rel = "") {
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(root, childRel);
    const descend = visit(full, childRel, entry);
    if (entry.isDirectory() && descend !== false) walk(root, visit, childRel);
  }
}

export function treeSize(dir) {
  let bytes = 0;
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return 0;
  }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  walk(dir, (full, _rel, entry) => {
    if (entry.isFile()) bytes += statSync(full).size;
  });
  return bytes;
}

// ------------------------------------------------------------ interpreter trim

// Paths relative to python/ that a headless worker never loads. Matched case
// insensitively (Windows' Lib/ and DLLs/), never descended once matched.
export const TRIM = [
  /^include$/i, // C headers
  /^share$/i, // man pages, terminfo
  /^libs$/i, // Windows import libraries
  /^scripts$/i, // Windows pip.exe and friends
  /^tcl$/i, // Windows Tcl/Tk library
  /^lib\/pkgconfig$/i,
  /^lib\/(tcl|tk|itcl|thread)[0-9][^/]*$/i, // Tcl/Tk script libraries
  /^lib\/lib(tcl|tk)[^/]*$/i, // libtcl9.0.so, libtcl9tk9.0.so
  // Linux: the interpreter is linked statically and never loads libpython (it is
  // for embedding); checkInterpreter runs the trimmed interpreter afterwards.
  /^lib\/libpython3[^/]*\.so(\.[0-9.]+)?$/i,
  /^bin\/(pip|idle|pydoc)[^/]*$/i, // launchers of trimmed modules
  /^bin\/python[^/]*-config$/i,
  /^(lib\/python3\.\d+|lib)\/(idlelib|tkinter|turtledemo|ensurepip|turtle\.py)$/i,
  /^(lib\/python3\.\d+|lib)\/site-packages\/pip(-[^/]*)?$/i, // the interpreter's own pip
  /^(lib\/python3\.\d+\/lib-dynload|dlls)\/_tkinter[^/]*$/i,
  // Linux: _dbm links Berkeley DB, whose Sleepycat licence asks every binary
  // redistribution to say how to get the complete DB source; nothing staged
  // imports dbm.ndbm (the dbm package falls back to dbm.sqlite3 and dbm.dumb).
  /^lib\/python3\.\d+\/lib-dynload\/_dbm\.[^/]*$/i,
  /^dlls\/(tcl|tk)[^/]*\.dll$/i,
  /^(tcl|tk)[0-9][^/]*\.dll$/i,
  // Windows debug symbols anywhere (python*.pdb, DLLs/*.pdb, Lib/venv/scripts/nt/*.pdb): 43 files,
  // 95 MB, and electron-builder's own pdb exclusion covers only the app's files, not extraResources.
  /(^|\/)[^/]*\.pdb$/i,
];

// Paths relative to app/site-packages that the worker never loads, removed after
// the install (case insensitive, never descended once matched). pywin32's Windows
// wheel ships the Pythonwin IDE and service hosts beside the modules the MCP SDK
// and portalocker import (win32/, win32/lib/, pywin32_system32/): Pythonwin bundles
// Scintilla (scintilla.dll, whose licence wants its notice in the documentation)
// and Microsoft's MFC runtime (mfc140u.dll), which THIRD_PARTY_LICENSES would
// otherwise have to carry. pywin32.pth's Pythonwin entry is skipped when the
// folder is missing.
export const SITE_TRIM = [
  /^pythonwin$/i, // Pythonwin.exe, win32ui, scintilla.dll, mfc140u.dll
  /^isapi$/i, // IIS extension host (PyISAPI_loader.dll)
  /^win32\/(pythonservice\.exe|perfmondata\.dll)$/i, // Windows service and perfmon hosts
  /^pywin32\.chm$/i, // the pywin32 help file
];

/** Relative paths under app/site-packages that SITE_TRIM removes (top-most only). */
export function siteTrimPlan(site) {
  const drop = [];
  walk(site, (_full, rel) => {
    if (SITE_TRIM.some((rx) => rx.test(rel))) {
      drop.push(rel);
      return false;
    }
    return true;
  });
  return drop;
}

/** The stdlib test package, dropped only when nothing staged imports it. */
export const STDLIB_TEST = /^(lib\/python3\.\d+|lib)\/test$/i;

/**
 * MANIFEST.json of a finished stage for `key`; throws when the stage is
 * missing, unfinished (no manifest or no .staged marker) or for another target.
 * With `expect` ({marker, hermesTag, sources}, each optional) it also throws
 * when the stage was built from other inputs than the checkout has now: an
 * older uv.lock, extras or Python pin (marker), another Hermes tag, or other
 * apps/agent sources (sources, sourceHash), so a stale stage is never packed.
 */
export function stagedManifest(out, key, expect = {}) {
  const file = path.join(out, "MANIFEST.json");
  if (!existsSync(file)) throw new Error(`${out} has no MANIFEST.json: stage the agent runtime first (node electron/stage-agent.mjs)`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.target !== key) throw new Error(`${file} is for ${manifest.target}, not ${key}`);
  if (!manifest.marker || !existsSync(path.join(out, manifest.marker))) {
    throw new Error(`${out} lacks its ${manifest.marker ?? ".staged-<hash>"} marker: the stage did not finish`);
  }
  const stale = [];
  if (expect.marker !== undefined && manifest.marker !== expect.marker) {
    stale.push(`it was installed from other inputs (${manifest.marker}, the checkout's uv.lock, extras and Python pin give ${expect.marker})`);
  }
  if (expect.hermesTag !== undefined && manifest.hermesTag !== expect.hermesTag) {
    stale.push(`it holds Hermes ${manifest.hermesTag || "(none)"}, the checkout has ${expect.hermesTag}`);
  }
  if (expect.sources && manifest.sources !== expect.sources) {
    stale.push(`apps/agent changed since it was staged (sources ${manifest.sources ?? "(not recorded)"}, now ${expect.sources})`);
  }
  if (stale.length) throw new Error(`${out} is stale: ${stale.join("; ")}. Stage it again (node electron/stage-agent.mjs).`);
  return manifest;
}

/**
 * sha256 (16 hex) of the files git tracks under apps/agent, path and working-tree
 * bytes, which is what the stage copies from; null without a checkout.
 */
export function sourceHash(repoRoot, tracked) {
  if (!tracked) return null;
  const h = createHash("sha256");
  for (const rel of [...tracked].filter((r) => r.startsWith("apps/agent/")).sort()) {
    const full = path.join(repoRoot, ...rel.split("/"));
    h.update(rel);
    h.update("\0");
    const st = existsSync(full) ? lstatSync(full) : null;
    if (st?.isSymbolicLink()) h.update(`-> ${readlinkSync(full)}`);
    else if (st?.isFile()) h.update(readFileSync(full));
    else h.update("(missing)");
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** Relative paths under python/ that trimInterpreter removes (top-most only). */
export function trimPlan(pythonDir) {
  const drop = [];
  const tests = [];
  walk(pythonDir, (_full, rel) => {
    if (STDLIB_TEST.test(rel)) {
      tests.push(rel);
      return false;
    }
    if (TRIM.some((rx) => rx.test(rel))) {
      drop.push(rel);
      return false;
    }
    return true;
  });
  return { drop, tests };
}

/** Does any of these Python sources import the stdlib `test` package? Returns the first file that does. */
export function importsStdlibTest(dirs) {
  const rx = /^\s*(from\s+test(\.[\w.]+)?\s+import\b|import\s+test(\.|\s*$|\s*,|\s+as\b))/m;
  let found = "";
  for (const dir of dirs) {
    if (found || !existsSync(dir)) continue;
    walk(dir, (full, rel, entry) => {
      if (found) return false;
      if (entry.isDirectory()) return !IGNORED_NAMES.has(entry.name);
      if (entry.isFile() && entry.name.endsWith(".py") && rx.test(readFileSync(full, "utf8"))) {
        found = `${dir}/${rel}`;
      }
      return true;
    });
  }
  return found;
}

/** The CPython licence inside a python-build-standalone tree. */
export function cpythonLicense(pythonDir) {
  const candidates = ["LICENSE.txt", "Lib/LICENSE.txt"];
  const lib = path.join(pythonDir, "lib");
  if (existsSync(lib)) {
    for (const name of readdirSync(lib)) {
      if (/^python3\.\d+$/.test(name)) candidates.push(`lib/${name}/LICENSE.txt`);
    }
  }
  for (const rel of candidates) {
    if (existsSync(path.join(pythonDir, rel))) return rel;
  }
  throw new Error(`no CPython licence in ${pythonDir} (looked for ${candidates.join(", ")}); it must ship`);
}

/** The interpreter of a staged tree (Go's packagedPython). */
export function stagedPython(root, platform = process.platform) {
  return platform === "win32" ? path.join(root, "python", "python.exe") : path.join(root, "python", "bin", "python3");
}

/** The stdlib folder compileall covers. */
export function stdlibDir(pythonDir) {
  if (existsSync(path.join(pythonDir, "Lib", "os.py"))) return path.join(pythonDir, "Lib");
  const lib = path.join(pythonDir, "lib");
  const name = existsSync(lib) ? readdirSync(lib).find((n) => /^python3\.\d+$/.test(n)) : undefined;
  if (!name) throw new Error(`no stdlib under ${pythonDir}`);
  return path.join(lib, name);
}

// ------------------------------------------------------------ imports

/**
 * Modules the staged interpreter must import through boot.py's sys.path (the
 * packaged app/site-packages and the folders its .pth files add). The MCP SDK
 * imports pywin32 at module level on Windows, and pywin32 lives in win32/ and
 * win32/lib/, reachable only after pywin32.pth ran.
 */
export const REQUIRED_IMPORTS = {
  all: ["mcp", "mcp.client.stdio"],
  win32: ["pywintypes", "win32api", "win32con", "win32job", "portalocker"],
};

/** Python source for `python -I -B -c`: boot.py's sys.path fix, then every required import; prints JSON. */
export function importCheckSource(bootPy, platform = process.platform) {
  const modules = [...REQUIRED_IMPORTS.all, ...(platform === "win32" ? REQUIRED_IMPORTS.win32 : [])];
  return [
    "import importlib, importlib.util, json",
    `spec = importlib.util.spec_from_file_location("timely_boot", ${JSON.stringify(bootPy)})`,
    "boot = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(boot)",
    "boot._fix_sys_path()",
    "failed = {}",
    `for name in ${JSON.stringify(modules)}:`,
    "    try:",
    "        importlib.import_module(name)",
    "    except Exception as exc:",
    "        failed[name] = f'{type(exc).__name__}: {exc}'",
    `print(json.dumps({"checked": ${JSON.stringify(modules)}, "failed": failed}))`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------ skills

/** Folders under `root` holding a SKILL.md, relative and posix (seed.skill_dirs). */
export function skillDirs(root) {
  const found = [];
  if (!existsSync(root)) return found;
  walk(root, (_full, rel, entry) => {
    if (IGNORED_NAMES.has(entry.name)) return false;
    if (entry.isFile() && entry.name === "SKILL.md") {
      found.push(rel.slice(0, -"/SKILL.md".length));
    }
    return true;
  });
  return found.sort();
}

export function hasSymlink(dir) {
  let found = false;
  walk(dir, (_full, _rel, entry) => {
    if (found || IGNORED_NAMES.has(entry.name)) return false;
    if (entry.isSymbolicLink()) found = true;
    return true;
  });
  return found;
}

/**
 * Which skills ship (decision 2 of the work packages, plan 9.1/9.3).
 *
 * Bundled (`skills/...`): the seed set prepare builds, i.e. entries of
 * skills-reviewed.json, minus skills-denied.json, minus any skill holding a
 * symlink, minus essential skills reviewed default off, minus skills a Timely
 * override replaces. Optional (`optional-skills/...`): reviewed `offered: true`
 * and not denied, no symlinks. Prepare re-checks the reviewed tree ids.
 */
export function selectSkills({ hermesDir, reviewed, denied, overrides = [] }) {
  const reviewedSkills = reviewed?.skills ?? reviewed ?? {};
  const deniedKeys = new Set(Object.keys(denied?.skills ?? {}));
  const overrideNames = new Set(overrides);
  const out = {
    seed: [],
    optional: [],
    excluded: { unreviewed: [], denied: [], symlinked: [], essentialOff: [], overridden: [], notOffered: [] },
  };
  for (const [prefix, list] of [
    ["skills", out.seed],
    ["optional-skills", out.optional],
  ]) {
    const root = path.join(hermesDir, prefix);
    for (const rel of skillDirs(root)) {
      const key = `${prefix}/${rel}`;
      const dir = path.join(root, rel);
      // seed.load_reviewed: a bare tree id means default on.
      const raw = reviewedSkills[key];
      const entry = typeof raw === "string" ? { tree: raw } : raw;
      if (prefix === "skills" && overrideNames.has(path.basename(rel))) out.excluded.overridden.push(key);
      else if (deniedKeys.has(key)) out.excluded.denied.push(key);
      else if (!entry || typeof entry !== "object" || typeof entry.tree !== "string") out.excluded.unreviewed.push(key);
      else if (hasSymlink(dir)) out.excluded.symlinked.push(key);
      else if (prefix === "optional-skills" && entry.offered !== true) out.excluded.notOffered.push(key);
      else if (
        prefix === "skills" &&
        String(entry.default ?? "on").toLowerCase() === "off" &&
        ESSENTIAL_SKILLS.has(path.basename(rel))
      )
        out.excluded.essentialOff.push(key);
      else list.push(rel);
    }
  }
  return out;
}

/**
 * cpSync filter for apps/agent/hermes → app/hermes: no __pycache__ or .pyc,
 * skills/ and optional-skills/ limited to the selected folders (category
 * files beside them stay), locales/ limited to en.yaml.
 */
export function hermesCopyFilter(srcRoot, { seed, optional }) {
  const all = {
    skills: new Set(skillDirs(path.join(srcRoot, "skills"))),
    "optional-skills": new Set(skillDirs(path.join(srcRoot, "optional-skills"))),
  };
  const keep = { skills: new Set(seed), "optional-skills": new Set(optional) };
  return (src) => {
    const rel = toPosix(path.relative(srcRoot, src));
    if (rel === "") return true;
    const parts = rel.split("/");
    if (parts.some((p) => IGNORED_NAMES.has(p)) || rel.endsWith(".pyc")) return false;
    if (parts[0] === "locales" && parts.length > 1) return rel === "locales/en.yaml";
    const area = parts[0];
    if (area in all && parts.length > 1) {
      const inner = parts.slice(1);
      for (let i = 1; i <= inner.length; i++) {
        const prefix = inner.slice(0, i).join("/");
        if (all[area].has(prefix)) return keep[area].has(prefix);
      }
    }
    return true;
  };
}

/** cpSync filter for Timely's own folders: no caches. */
export function plainCopyFilter(srcRoot) {
  return (src) => {
    const rel = toPosix(path.relative(srcRoot, src));
    return rel === "" || !(rel.split("/").some((p) => IGNORED_NAMES.has(p) || p === ".pytest_cache" || p === ".ruff_cache") || rel.endsWith(".pyc"));
  };
}

/**
 * Repo-relative paths ("/"-separated) of the files git tracks under `folders`,
 * or null when `repoRoot` is not a git checkout (the Docker build stage, whose
 * context leaves out .git and every .env). Throws when it is one and git
 * cannot list it: the stage never falls back to copying untracked files.
 */
export function gitTracked(repoRoot, folders) {
  if (!existsSync(path.join(repoRoot, ".git"))) return null;
  const r = spawnSync("git", ["-c", "core.quotepath=off", "ls-files", "-z", "--cached", "--", ...folders], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1048576,
  });
  if (r.error || r.status !== 0) {
    throw new Error(`git ls-files failed in ${repoRoot} (${r.error?.message ?? `exit ${r.status}`}): ${r.stderr ?? ""}`);
  }
  return new Set(r.stdout.split("\0").filter(Boolean));
}

/** The tracked-file list `make agent-tracked-list` writes for builds without .git (the Docker build stage). */
export const TRACKED_LIST = "apps/agent/.git-tracked";

/**
 * The files git tracks under apps/agent, for the stage's copy filter: from
 * git in a checkout, else from TRACKED_LIST (`git ls-files -z` output, which
 * make docker-api and make docker-agent-smoke write before building). Throws
 * when there is neither, so an untracked credential, key or lock file in the
 * build context can never reach an image.
 */
export function trackedSources(repoRoot) {
  const fromGit = gitTracked(repoRoot, ["apps/agent"]);
  if (fromGit) return { tracked: fromGit, from: "git" };
  const list = path.join(repoRoot, ...TRACKED_LIST.split("/"));
  if (existsSync(list)) {
    const tracked = new Set(readFileSync(list, "utf8").split("\0").filter(Boolean));
    if (tracked.size === 0) throw new Error(`${TRACKED_LIST} lists no file: write it again with make agent-tracked-list`);
    return { tracked, from: TRACKED_LIST };
  }
  throw new Error(
    `no git checkout at ${repoRoot} and no ${TRACKED_LIST}: the stage copies only files git tracks, so it cannot tell ` +
      "them from untracked ones. Run make agent-tracked-list in the checkout before docker build or docker compose build " +
      "(make docker-api and make docker-agent-smoke do it).",
  );
}

/**
 * Wraps a cpSync filter so that only files git tracks (and the folders holding
 * them) are copied: an untracked or ignored .env, credential file or virtualenv
 * in the working tree never reaches the stage. `tracked` null (no checkout)
 * returns `filter` itself. What the inner filter would have copied but git
 * does not track is pushed onto `skipped` (repo-relative; a folder once).
 */
export function trackedOnly(filter, { repoRoot, tracked, skipped = [] }) {
  if (!tracked) return filter;
  const dirs = new Set();
  for (const file of tracked) {
    for (let i = file.lastIndexOf("/"); i > 0; i = file.lastIndexOf("/", i - 1)) dirs.add(file.slice(0, i));
  }
  return (src, dest) => {
    if (!filter(src, dest)) return false;
    const rel = toPosix(path.relative(repoRoot, src));
    if (tracked.has(rel) || dirs.has(rel)) return true;
    skipped.push(rel);
    return false;
  };
}

/** Untracked names a build context's apps/agent may hold without the tracked-file list being stale. */
export const UNTRACKED_CONTEXT_NAMES = new Set([".hermes-update.lock", ".git-tracked", ".DS_Store"]);

/**
 * For a stage without git (the Docker build), where TRACKED_LIST stands in for
 * git: the files the copy left out although the context holds them (`skipped`,
 * from trackedOnly), and the files under apps/agent the list names but the
 * context lacks. .dockerignore keeps the virtualenv, caches and .env out, so
 * either kind almost always means the list predates a commit (a Hermes sync, a
 * new timely_agent module), and the image would ship a runtime that cannot
 * import its own modules. Returns {unlisted, missing}, repo-relative.
 */
export function staleTrackedList({ repoRoot, tracked, skipped }) {
  const unlisted = [];
  for (const rel of skipped) {
    const full = path.join(repoRoot, ...rel.split("/"));
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      if (!UNTRACKED_CONTEXT_NAMES.has(path.basename(full))) unlisted.push(rel);
      continue;
    }
    walk(full, (_f, sub, entry) => {
      if (entry.isDirectory()) return !IGNORED_NAMES.has(entry.name);
      if (!UNTRACKED_CONTEXT_NAMES.has(entry.name) && !/\.py[co]$/.test(entry.name)) unlisted.push(`${rel}/${sub}`);
      return true;
    });
  }
  const missing = [...tracked]
    .filter((rel) => rel.startsWith("apps/agent/"))
    .filter((rel) => {
      try {
        lstatSync(path.join(repoRoot, ...rel.split("/")));
        return false;
      } catch {
        return true;
      }
    })
    .sort();
  return { unlisted: unlisted.sort(), missing };
}

/**
 * Names of the skill folders under `dir` (apps/agent/skills/overrides) whose
 * SKILL.md git tracks; all of them when `tracked` is null (no checkout). An
 * untracked override never ships (trackedOnly), so it must not hide the
 * upstream skill it replaces either.
 */
export function trackedSkillNames(dir, { repoRoot, tracked }) {
  return skillDirs(dir)
    .filter((rel) => !tracked || tracked.has(toPosix(path.relative(repoRoot, path.join(dir, rel, "SKILL.md")))))
    .map((rel) => path.basename(rel));
}

/** cpSync `src` to `dest`, leaving `dest` a folder even when `src` is missing or the filter copies nothing. */
export function copyInto(src, dest, opts) {
  if (existsSync(src)) cpSync(src, dest, opts);
  mkdirSync(dest, { recursive: true });
}

/** 0444 files and 0555 folders (the read-only attribute on Windows files). */
export function makeReadOnly(dir) {
  walk(dir, (full, _rel, entry) => {
    if (entry.isFile()) chmodSync(full, 0o444);
    return true;
  });
  walk(dir, (full, _rel, entry) => {
    if (entry.isDirectory()) chmodSync(full, 0o555);
    return true;
  });
  chmodSync(dir, 0o555);
}

/** Undo makeReadOnly (and chmod -R a-w) so the tree can be removed. */
export function makeWritable(dir) {
  if (!existsSync(dir)) return;
  const st = lstatSync(dir);
  if (st.isSymbolicLink()) return;
  chmodSync(dir, st.mode | 0o700);
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) makeWritable(full);
    else if (entry.isFile()) chmodSync(full, statSync(full).mode | 0o600);
  }
}

// ------------------------------------------------------------ checks

const BROWSER_DIST = /^(playwright|pyppeteer|ms-playwright|chromium|undetected[-_]chromedriver)([-_.][^/]*)?$/i;
const BROWSER_FILE = /^(chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell)(\.exe)?$/i;

/**
 * Deletes compiled bytecode whose path relative to `root` is longer than
 * `maxChars`, and the `__pycache__` folders this empties. The module's source
 * stays, so it imports from source; the packaged worker never writes bytecode
 * (the boot.py shim sets sys.dont_write_bytecode, and the install may be
 * read-only), so nothing appears later either. Only a `.pyc` inside
 * `__pycache__` is dropped: a longer source file still fails checkTree.
 * Returns the dropped paths.
 */
export function dropLongBytecode(root, maxChars = MAX_PATH_CHARS) {
  const dropped = [];
  const caches = new Set();
  walk(root, (full, rel, entry) => {
    if (entry.isSymbolicLink()) return false;
    if (entry.isFile() && rel.length > maxChars && rel.endsWith(".pyc") && path.basename(path.dirname(full)) === "__pycache__") {
      rmSync(full);
      dropped.push(rel);
      caches.add(path.dirname(full));
    }
    return true;
  });
  for (const dir of caches) {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  return dropped;
}

const SECRET_FILE = /^(\.env(\..+)?|\.op\.env|auth\.json|\.netrc|_netrc|\.pypirc|\.npmrc|credentials?(\.[\w-]+)?\.json|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keystore|jks))$/i;
const SECRET_DIR = /^(mcp-tokens|\.venv.*|\.ssh|\.gnupg|\.aws)$/i;

function localSecret(entry) {
  if (entry.isDirectory()) return SECRET_DIR.test(entry.name);
  return SECRET_FILE.test(entry.name) && entry.name.toLowerCase() !== ".env.example";
}

/**
 * Whole-tree checks (plan 11.4, work packages step 8). Returns a list of
 * problems, empty when the tree may ship:
 * - a symlink with an absolute target, or one resolving outside the root;
 * - a path longer than `maxChars` relative to the root;
 * - a file holding the absolute stage path (a build-machine path that would ship);
 * - a browser: playwright/pyppeteer/Chromium in site-packages or a Chrome binary anywhere (ADR 0022);
 * - under app/ (outside the hash-pinned wheels in site-packages): a dotenv file other than
 *   .env.example, .op.env, auth.json, .netrc, .pypirc, .npmrc, credentials*.json, an SSH key
 *   (id_rsa, id_ed25519, ...), a *.pem, *.key, *.p12, *.pfx, keystore or jks file, or an
 *   mcp-tokens/, .ssh/, .gnupg/, .aws/ or virtualenv (.venv*) folder, which only a developer's
 *   working tree holds (plan 12: secrets never reach the worker).
 */
export function checkTree(root, { stagePath = root, maxChars = MAX_PATH_CHARS, sitePackages = "app/site-packages" } = {}) {
  const problems = [];
  const needles = [...new Set([stagePath, stagePath.replaceAll("\\", "/"), stagePath.replaceAll("/", "\\")])].map((s) =>
    Buffer.from(s, "utf8"),
  );
  let longest = "";
  walk(root, (full, rel, entry) => {
    if (rel.length > longest.length) longest = rel;
    if (rel.length > maxChars) problems.push(`path longer than ${maxChars} characters (${rel.length}): ${rel}`);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(full);
      if (path.isAbsolute(target) || path.win32.isAbsolute(target)) {
        problems.push(`symlink with an absolute target: ${rel} -> ${target}`);
      } else {
        const resolved = path.resolve(path.dirname(full), target);
        const back = path.relative(root, resolved);
        if (back.startsWith("..") || path.isAbsolute(back)) {
          problems.push(`symlink resolving outside the root: ${rel} -> ${target}`);
        }
      }
      return false;
    }
    if (rel.startsWith("app/") && !rel.startsWith(`${sitePackages}/`) && localSecret(entry)) {
      problems.push(`a local secret or environment never ships (copy only what git tracks): ${rel}`);
      return false;
    }
    const inSite = rel.startsWith(`${sitePackages}/`) && rel.slice(sitePackages.length + 1).split("/").length === 1;
    if (inSite && BROWSER_DIST.test(entry.name)) problems.push(`browser package in site-packages: ${rel} (ADR 0022)`);
    if (entry.isFile() && BROWSER_FILE.test(entry.name)) problems.push(`browser binary: ${rel} (ADR 0022)`);
    if (entry.isFile()) {
      const data = readFileSync(full);
      if (needles.some((n) => data.includes(n))) problems.push(`holds the absolute stage path ${stagePath}: ${rel}`);
    }
    return true;
  });
  return { problems, longest };
}

// ------------------------------------------------------------ licences

/** RFC 822 headers of a METADATA file (until the first blank line), continuation lines folded. */
export function parseMetadata(text) {
  const headers = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === "") break;
    if (/^\s/.test(line) && headers.length) {
      headers[headers.length - 1][1] += `\n${line.replace(/^ {7}\|?/, "").trimStart()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i > 0) headers.push([line.slice(0, i), line.slice(i + 1).trim()]);
  }
  const get = (name) => headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
  return {
    name: get("Name")[0] ?? "",
    version: get("Version")[0] ?? "",
    expression: get("License-Expression")[0] ?? "",
    license: get("License")[0] ?? "",
    classifiers: get("Classifier").filter((c) => c.startsWith("License ::")),
    licenseFiles: get("License-File"),
  };
}

const LICENSE_NAME = /^(licen[cs]e|copying|notice|authors|copyright)/i;

/** PEP 503 normalized distribution name. */
export const normalizeDist = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

/**
 * Every `*.dist-info` in site-packages with its licence metadata and the text
 * of its licence files. A distribution whose wheel ships no licence file takes
 * the text `overrides` names for it ({normalized name: {file}}, read from
 * `licensesDir`); `missing` names distributions left without any licence text,
 * since a licence name alone (MIT, BSD) does not carry the copyright notice
 * those licences require.
 */
export function collectLicenses(sitePackages, { licensesDir = "", overrides = {} } = {}) {
  const dists = [];
  const missing = [];
  for (const name of readdirSync(sitePackages).sort()) {
    if (!name.endsWith(".dist-info")) continue;
    const info = path.join(sitePackages, name);
    const metaFile = path.join(info, "METADATA");
    const meta = existsSync(metaFile) ? parseMetadata(readFileSync(metaFile, "utf8")) : parseMetadata("");
    const files = new Map();
    const add = (full) => {
      if (existsSync(full) && statSync(full).isFile()) files.set(toPosix(path.relative(info, full)), readFileSync(full, "utf8"));
    };
    for (const lf of meta.licenseFiles) {
      add(path.join(info, "licenses", lf));
      add(path.join(info, lf));
    }
    if (existsSync(path.join(info, "licenses"))) {
      walk(path.join(info, "licenses"), (full, _rel, entry) => {
        if (entry.isFile()) add(full);
        return true;
      });
    }
    for (const entry of readdirSync(info, { withFileTypes: true })) {
      if (entry.isFile() && LICENSE_NAME.test(entry.name)) add(path.join(info, entry.name));
    }
    const dist = {
      dir: name,
      name: meta.name || name.replace(/-[^-]+\.dist-info$/, ""),
      version: meta.version,
      license: meta.expression || meta.license.split("\n")[0].slice(0, 200) || meta.classifiers.join("; "),
      files: [...files].map(([rel, text]) => ({ rel, text })),
    };
    const override = dist.files.length === 0 ? overrides[normalizeDist(dist.name)] : undefined;
    if (override && licensesDir) {
      dist.files.push({ rel: `apps/agent/packaging/licenses/${override.file}`, text: readFileSync(path.join(licensesDir, override.file), "utf8") });
    }
    if (dist.files.length === 0) missing.push(dist.name);
    dists.push(dist);
  }
  return { dists, missing };
}

/** python-build-standalone's `full` archive of the build an `install_only` archive comes from. */
export function fullArchiveName(installOnly) {
  if (!installOnly.endsWith("-install_only.tar.gz")) throw new Error(`${installOnly} is not an install_only archive`);
  const variant = installOnly.includes("-pc-windows-") ? "pgo" : "pgo+lto";
  return installOnly.replace(/-install_only\.tar\.gz$/, `-${variant}-full.tar.zst`);
}

/**
 * Libraries a module is built from where PYTHON.json may give no licence path.
 * On win32-x64 python-build-standalone records none for pyexpat (expat),
 * _decimal (mpdecimal 4) and zlib (zlib-ng, in python3XX.dll and zlib1.dll),
 * yet the binaries hold them and the `full` archive has their texts; the
 * other targets record them. pythonLicenseRecord falls back to these, and
 * interpreterModuleProblems fails a stage whose record lacks one it ships.
 */
export const BUNDLED_LIBRARIES = {
  pyexpat: { file: "LICENSE.expat.txt", spdx: ["MIT"] },
  _decimal: { file: "LICENSE.mpdecimal.txt", spdx: ["BSD-2-Clause"] },
  zlib: { file: "LICENSE.zlib-ng.txt", spdx: ["Zlib"] },
};

/**
 * What python-licenses.mjs records for one target from a `full` archive's
 * PYTHON.json and python/licenses/: per licence file, the SPDX ids and the
 * modules that link the library, with BUNDLED_LIBRARIES standing in for a
 * module PYTHON.json gives no licence path. CPython's own licence is left out
 * (the install_only archive ships it).
 */
export function pythonLicenseRecord({ key, archive, sha256, meta, texts }) {
  const byFile = new Map();
  const extensions = meta?.build_info?.extensions ?? {};
  for (const [module, variants] of Object.entries(extensions)) {
    for (const v of variants) {
      for (const rel of v.license_paths ?? []) {
        const file = path.posix.basename(rel);
        if (!(file in texts)) throw new Error(`${archive}: ${module} names ${rel}, which the archive does not hold`);
        const lib = byFile.get(file) ?? { file, spdx: new Set(), modules: new Set(), publicDomain: false };
        for (const id of v.licenses ?? []) lib.spdx.add(id);
        lib.modules.add(module);
        lib.publicDomain ||= v.license_public_domain === true;
        byFile.set(file, lib);
      }
    }
  }
  if (byFile.size === 0) throw new Error(`${archive}: PYTHON.json names no licence files for its extension modules`);
  for (const [module, fallback] of Object.entries(BUNDLED_LIBRARIES)) {
    const variants = extensions[module];
    if (!variants || variants.some((v) => (v.license_paths ?? []).length)) continue;
    if (!(fallback.file in texts)) throw new Error(`${archive}: ${module} has no licence path and the archive holds no ${fallback.file}`);
    const lib = byFile.get(fallback.file) ?? { file: fallback.file, spdx: new Set(), modules: new Set(), publicDomain: false };
    for (const id of fallback.spdx) lib.spdx.add(id);
    lib.modules.add(module);
    byFile.set(fallback.file, lib);
  }
  const libraries = [...byFile.values()]
    .map((l) => ({ file: l.file, spdx: [...l.spdx].sort(), modules: [...l.modules].sort(), publicDomain: l.publicDomain }))
    .sort((a, b) => (a.file < b.file ? -1 : 1));
  return { target: key, archive, sha256, python: meta.python_version, cpython: meta.licenses ?? [], libraries };
}

/**
 * The recorded licences of the interpreter's built-in libraries for `key`
 * (apps/agent/packaging/python-licenses/<version>/<key>.json), each with its text.
 */
export function interpreterLicenses(root, version, key) {
  const file = path.join(root, version, `${key}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `no licence record of the interpreter's built-in libraries for Python ${version} on ${key} (${file}). ` +
        "Run make agent-python-licenses after a Hermes sync that moves the Python pin, and commit the result.",
    );
  }
  const record = JSON.parse(readFileSync(file, "utf8"));
  return record.libraries.map((lib) => ({ ...lib, text: readFileSync(path.join(root, version, "texts", lib.file), "utf8") }));
}

/**
 * Problems for interpreter modules shipped as their own file (DLLs/*.pyd,
 * lib-dynload/*.so, Windows' zlib1.dll) that link a BUNDLED_LIBRARIES library
 * no licence in `libraries` (interpreterLicenses) covers. On Linux and macOS
 * these modules are built into the interpreter, which the record covers from
 * PYTHON.json.
 */
export function interpreterModuleProblems(pythonDir, libraries) {
  const covered = new Set(libraries.flatMap((l) => l.modules));
  const problems = [];
  walk(pythonDir, (_full, rel, entry) => {
    if (!entry.isFile()) return true;
    const name = entry.name.toLowerCase();
    const module = /^zlib1\.dll$/.test(name) ? "zlib" : /^([a-z_]+?)(\.[\w-]+)?\.(pyd|so|dylib)$/.exec(name)?.[1];
    if (module && BUNDLED_LIBRARIES[module] && !covered.has(module)) {
      problems.push(`python/${rel} links ${BUNDLED_LIBRARIES[module].file.replace(/^LICENSE\.|\.txt$/g, "")}, which the interpreter's licence record does not cover: run make agent-python-licenses and commit the result`);
    }
    return true;
  });
  return problems;
}

/** The file holding CPython's "Licenses and Acknowledgements for Incorporated Software" for a lock version. */
export const INCORPORATED_FILE = "incorporated.txt";

/**
 * The notices of the third-party code CPython compiles into the interpreter
 * itself (mimalloc, HACL*, dtoa, SipHash, Mersenne Twister, cfuhash, expat,
 * libmpdec, the zstd bindings, ...), which CPython's LICENSE.txt leaves out:
 * the "Licenses and Acknowledgements for Incorporated Software" section of
 * Doc/license.rst at the tag (`rst`), then the HACL* licence from the header
 * of Modules/_hacl/Hacl_Hash_SHA2.c (`hacl`), which that section does not list.
 */
export function cpythonIncorporated({ rst, hacl, python }) {
  const tag = `v${python}`;
  const lines = rst.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l, i) => l === "Licenses and Acknowledgements for Incorporated Software" && /^=+$/.test(lines[i + 1] ?? ""));
  if (start < 0) throw new Error(`Doc/license.rst at ${tag} has no "Licenses and Acknowledgements for Incorporated Software" section`);
  const section = lines.slice(start).join("\n").trim();
  const header = /^\/\*\s*MIT License\s*\n([\s\S]*?)\*\//.exec(hacl.replace(/\r\n/g, "\n"));
  if (!header) throw new Error(`Modules/_hacl/Hacl_Hash_SHA2.c at ${tag} does not start with its MIT licence header`);
  const haclText = ["MIT License", ...header[1].split("\n").map((l) => l.replace(/^ ?\* ?/, ""))].join("\n").trim();
  return [
    `CPython ${python}: the third-party code CPython builds into the interpreter (CPython's LICENSE.txt above leaves it out).`,
    `From https://github.com/python/cpython/blob/${tag}/Doc/license.rst and, for HACL*, the header of Modules/_hacl/Hacl_Hash_SHA2.c.`,
    "",
    section,
    "",
    "",
    "HACL*",
    "-----",
    "",
    "The built-in MD5, SHA-1, SHA-2, SHA-3, BLAKE2 and HMAC of the :mod:`hashlib` module (Modules/_hacl) come from",
    "HACL* (https://github.com/hacl-star/hacl-star), distributed under the MIT license::",
    "",
    ...haclText.split("\n").map((l) => (l ? `   ${l}` : "")),
    "",
  ].join("\n");
}

/** The recorded notices of the code CPython incorporates (cpythonIncorporated) for a lock version. */
export function incorporatedLicenses(root, version) {
  const file = path.join(root, version, INCORPORATED_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `no notices of the code CPython ${version} incorporates (${file}). Run make agent-python-licenses after a Hermes sync ` +
        "that moves the Python pin, and commit the result.",
    );
  }
  return readFileSync(file, "utf8");
}

/** Does this distribution ship GPL or LGPL code (its metadata licence, or a `License: ...GPL` line in a licence file)? */
export function declaresCopyleft(dist) {
  if (/\bL?GPL/.test(dist.license)) return true;
  return dist.files.some((f) => /^[ \t]*License:[^\n]*\bL?GPL/im.test(f.text));
}

/**
 * The reviewed copyleft distributions (apps/agent/packaging/licenses/copyleft.json)
 * among `dists`, and a problem for each copyleft distribution that is not
 * reviewed or whose version moved since.
 */
export function copyleftReview(dists, policy) {
  const listed = [];
  const problems = [];
  for (const d of dists) {
    if (!declaresCopyleft(d)) continue;
    const entry = policy[normalizeDist(d.name)];
    if (!entry) {
      problems.push(
        `${d.name} ${d.version} ships GPL or LGPL code: review it and record its libraries, their sources and the licence texts in apps/agent/packaging/licenses/copyleft.json`,
      );
    } else if (entry.version !== d.version) {
      problems.push(
        `${d.name} is ${d.version} but apps/agent/packaging/licenses/copyleft.json reviewed ${entry.version}: check its bundled libraries, versions and source links, then update the entry`,
      );
    } else listed.push({ dist: d, entry });
  }
  return { listed, problems };
}

/** Native code a wheel ships: extension modules and the shared libraries next to them. */
export const NATIVE_BINARY = /\.(so(\.\d+)*|pyd|dylib|dll)$/i;

// A crate's source path as rustc records it (panic locations, file!()): crates.io's
// registry checkout (index.crates.io-<hash>, older github.com-<hash>) or the standard
// library's own dependencies (/rust/deps/<crate>-<version>).
const CRATE_PATH = /(?:(?:index\.crates\.io|github\.com)-[0-9a-f]{16}|[/\\]rust[/\\]deps)[/\\]([A-Za-z0-9_-]+?)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.-]+)?)[/\\]/g;
const RUSTC_PATH = /[/\\]rustc[/\\]([0-9a-f]{40})[/\\]library[/\\]/g;
const GIT_CRATE_PATH = /[/\\]git[/\\]checkouts[/\\]([A-Za-z0-9_-]+)-[0-9a-f]{16}[/\\]/g;

/**
 * The Rust code linked into one binary, from the source paths rustc leaves in
 * it: crates as "name@version" (sorted), the rustc commits of the standard
 * library, and crates built from a git checkout instead of crates.io.
 */
export function rustCrates(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer);
  const crates = new Set();
  for (const m of text.matchAll(CRATE_PATH)) crates.add(`${m[1]}@${m[2]}`);
  const rustc = new Set([...text.matchAll(RUSTC_PATH)].map((m) => m[1]));
  const git = new Set([...text.matchAll(GIT_CRATE_PATH)].map((m) => m[1]));
  return { crates: [...crates].sort(), rustc: [...rustc].sort(), git: [...git].sort() };
}

/** RECORD's file paths ("path,hash,size"; a path holding a comma is double-quoted). */
function recordPaths(text) {
  const paths = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('"')) {
      const end = line.indexOf('",');
      if (end > 0) paths.push(line.slice(1, end).replaceAll('""', '"'));
    } else paths.push(line.slice(0, line.indexOf(",") < 0 ? line.length : line.indexOf(",")));
  }
  return paths;
}

/**
 * Every native binary under site-packages, grouped by the distribution whose
 * RECORD lists it, with the Rust crates linked into it. Returns
 * {dists: [{name, version, key, binaries: [{rel, crates, rustc, git}]}],
 * unowned: [rel]}, `key` being "<normalized name>-<version>" (the record's
 * file name) and `unowned` binaries no RECORD lists. Only distributions with
 * at least one native binary appear.
 */
export function nativeBinaries(sitePackages) {
  const owner = new Map();
  const dists = new Map();
  for (const name of readdirSync(sitePackages).sort()) {
    if (!name.endsWith(".dist-info")) continue;
    const info = path.join(sitePackages, name);
    const meta = existsSync(path.join(info, "METADATA")) ? parseMetadata(readFileSync(path.join(info, "METADATA"), "utf8")) : parseMetadata("");
    const dist = { name: meta.name || name.replace(/-[^-]+\.dist-info$/, ""), version: meta.version, dir: name, binaries: [] };
    dist.key = `${normalizeDist(dist.name)}-${dist.version}`;
    dists.set(name, dist);
    const record = path.join(info, "RECORD");
    if (!existsSync(record)) continue;
    for (const rel of recordPaths(readFileSync(record, "utf8"))) {
      const norm = path.posix.normalize(rel.replaceAll("\\", "/"));
      if (NATIVE_BINARY.test(norm) && !norm.startsWith("../")) owner.set(norm, dist);
    }
  }
  const unowned = [];
  walk(sitePackages, (full, rel, entry) => {
    if (!entry.isFile() || !NATIVE_BINARY.test(entry.name)) return true;
    const found = { rel, ...rustCrates(readFileSync(full)) };
    const dist = owner.get(rel);
    if (dist) dist.binaries.push(found);
    else unowned.push(rel);
    return true;
  });
  return { dists: [...dists.values()].filter((d) => d.binaries.length), unowned };
}

/**
 * The reviewed records of code linked statically into wheels
 * (apps/agent/packaging/licenses/static/<normalized name>-<version>.json,
 * written by make agent-static-licenses) for the distributions `found`
 * (nativeBinaries().dists), each crate and component with its licence texts.
 * A problem for each distribution whose binaries link Rust code, or that
 * `components` (static/components.json: hand-listed C libraries) names, but
 * has no record for its exact version, each crate a binary links that its record
 * lacks, a standard library with no recorded texts, and a crate from a git
 * checkout (no crates.io licence to record).
 */
export function staticLicenses(found, staticDir, { components = {} } = {}) {
  const records = [];
  const problems = [];
  const hint = "run make agent-static-licenses, review the result and commit it";
  const text = (id) => readFileSync(path.join(staticDir, "texts", `${id}.txt`), "utf8");
  for (const dist of found) {
    const linked = new Set(dist.binaries.flatMap((b) => b.crates));
    const std = dist.binaries.some((b) => b.rustc.length);
    for (const b of dist.binaries) {
      for (const g of b.git) problems.push(`${dist.name} ${dist.version}: ${b.rel} links ${g} from a git checkout, not crates.io; record its licence by hand`);
    }
    const file = path.join(staticDir, `${dist.key}.json`);
    const listed = components[normalizeDist(dist.name)];
    if (!existsSync(file)) {
      if (listed) {
        problems.push(`${dist.name} ${dist.version} links ${listed.map((c) => c.name).join(", ")} in (static/components.json), but static/${dist.key}.json does not exist: ${hint}`);
      } else if (linked.size || std) {
        problems.push(
          `${dist.name} ${dist.version} links ${linked.size} Rust crate(s) into ${dist.binaries.filter((b) => b.crates.length || b.rustc.length).map((b) => b.rel).join(", ")}, ` +
            `but apps/agent/packaging/licenses/static/${dist.key}.json does not record their licences: ${hint}`,
        );
      }
      continue;
    }
    const record = JSON.parse(readFileSync(file, "utf8"));
    const recorded = new Set((record.crates ?? []).map((c) => `${c.name}@${c.version}`));
    const absent = [...linked].filter((c) => !recorded.has(c)).sort();
    if (absent.length) {
      problems.push(`${dist.name} ${dist.version} links crates static/${dist.key}.json does not record (${absent.length}): ${absent.slice(0, 12).join(", ")}${absent.length > 12 ? ", ..." : ""}; ${hint}`);
    }
    if (std && !record.rustStd?.texts?.length) problems.push(`${dist.name} ${dist.version} links the Rust standard library, which static/${dist.key}.json does not record; ${hint}`);
    const withTexts = (entry) => ({ ...entry, files: (entry.files ?? []).map((f) => ({ ...f, body: text(f.text) })) });
    records.push({
      dist,
      record: {
        ...record,
        rustStd: record.rustStd ? { ...record.rustStd, files: record.rustStd.texts.map((f) => ({ ...f, body: text(f.text) })) } : null,
        crates: (record.crates ?? []).map(withTexts),
        components: (record.components ?? []).map(withTexts),
      },
    });
  }
  return { records, problems };
}

/**
 * THIRD_PARTY_LICENSES: CPython, the code it incorporates (`incorporated`,
 * incorporatedLicenses), the libraries built into the interpreter,
 * Hermes, Timely's NOTICE, every distribution, the code linked statically
 * into distributions' native modules (`statics`, from staticLicenses), then the GPL and LGPL
 * libraries shipped in binary form with their sources and the full licence
 * texts they need (`gnuTexts`: {id: text}).
 */
export function thirdPartyLicenses({ cpython, incorporated = "", interpreter = [], hermes, notice, dists, statics = [], copyleft = [], gnuTexts = {} }) {
  const rule = "=".repeat(78);
  const parts = [
    "Third-party software in Timely's agent runtime (resources/agent, /app/agent).",
    "",
    rule,
    "CPython (python/), Python Software Foundation License",
    rule,
    cpython.trim(),
    "",
  ];
  if (incorporated.trim()) parts.push(rule, "Software incorporated in CPython (python/)", rule, incorporated.trim(), "");
  if (interpreter.length) {
    parts.push(
      rule,
      "Libraries built into the interpreter (python/)",
      rule,
      "python-build-standalone links these into the interpreter and its extension modules; the texts come",
      "from the matching `full` archive (apps/agent/packaging/python-licenses/). Modules this runtime",
      "trims (_tkinter, and _dbm on Linux) are listed as the archive records them.",
      "",
    );
    for (const lib of interpreter) {
      const ids = lib.spdx.length ? lib.spdx.join(", ") : lib.publicDomain ? "public domain" : "see text";
      parts.push(`--- ${lib.file.replace(/^LICENSE\.|(\.[\w-]+)?\.txt$/g, "")}: ${ids} (used by ${lib.modules.join(", ")})`, lib.text.trim(), "");
    }
  }
  parts.push(
    rule,
    "Hermes Agent (app/hermes/), MIT License",
    rule,
    hermes.trim(),
    "",
    rule,
    "Timely agent NOTICE",
    rule,
    notice.trim(),
    "",
  );
  for (const d of dists) {
    parts.push(rule, `${d.name} ${d.version} (app/site-packages/${d.dir}): ${d.license || "see licence files"}`, rule);
    for (const f of d.files) parts.push(`--- ${f.rel}`, f.text.trim(), "");
    if (d.files.length === 0) parts.push("");
  }
  if (statics.length) {
    parts.push(
      rule,
      "Code linked statically into the native modules of these distributions",
      rule,
      "Rust extension modules carry the crates they were built from and the Rust standard library, and some",
      "wheels link C libraries in as well (apps/agent/packaging/licenses/static/). Each line names what is",
      "linked, its licence and the texts that apply to it; every text follows once, under its [id], at the",
      "end of this section.",
      "",
    );
    const texts = new Map();
    const ref = (files) => {
      for (const f of files) if (!texts.has(f.text)) texts.set(f.text, { label: f.label, body: f.body });
      return files.length ? `[${files.map((f) => f.text).join(", ")}]` : "";
    };
    for (const { dist, record } of statics) {
      parts.push(`${dist.name} ${dist.version} (app/site-packages/${dist.dir}):`);
      if (record.rustStd) {
        const files = record.rustStd.files.map((f) => ({ ...f, label: `Rust standard library ${f.rel}` }));
        parts.push(`  Rust standard library (rustc ${record.rustStd.rustc.map((c) => c.slice(0, 12)).join(", ")}): ${record.rustStd.license} ${ref(files)}`);
      }
      for (const c of record.components) {
        const files = c.files.map((f) => ({ ...f, label: `${c.name} ${c.version} ${f.rel}` }));
        parts.push(`  ${c.name} ${c.version} (${c.kind ?? "C library"}): ${c.license} ${ref(files)}`);
      }
      for (const c of record.crates) {
        const files = c.files.map((f) => ({ ...f, label: `${c.name} ${c.version} ${f.rel}` }));
        parts.push(`  ${c.name} ${c.version}: ${c.license || "see text"} ${ref(files)}`);
      }
      parts.push("");
    }
    for (const [id, { label, body }] of texts) parts.push(`--- [${id}] ${label}`, body.trim(), "");
  }
  if (copyleft.length) {
    const ids = [...new Set(copyleft.flatMap(({ entry }) => entry.texts))];
    const missingText = ids.filter((id) => !gnuTexts[id]);
    if (missingText.length) throw new Error(`no licence text for ${missingText.join(", ")} in apps/agent/packaging/licenses/gnu/`);
    parts.push(rule, "GPL and LGPL libraries shipped in binary form, and where to get their source", rule);
    for (const { dist, entry } of copyleft) {
      parts.push(`${dist.name} ${dist.version} (app/site-packages/${dist.dir}): ${entry.why}`);
      for (const lib of entry.libraries) parts.push(`  - ${lib.name}: ${lib.license}; ${lib.files}`, `    complete source: ${lib.source}`);
      parts.push("");
    }
    for (const id of ids) parts.push(rule, `Full text: ${id}`, rule, gnuTexts[id].trim(), "");
  }
  return `${parts.join("\n")}\n`;
}

// ------------------------------------------------------------ manifest

/** Every regular file (path, size) and symlink under root, posix, sorted; MANIFEST.json itself left out. */
export function listTree(root) {
  const files = [];
  const links = [];
  walk(root, (full, rel, entry) => {
    if (entry.isSymbolicLink()) links.push([rel, readlinkSync(full)]);
    else if (entry.isFile() && rel !== "MANIFEST.json") files.push([rel, statSync(full).size]);
    return true;
  });
  files.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  links.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { files, links };
}

/** Bytes per folder prefix (depth 1..maxDepth), largest first. */
export function largestFolders(files, { depth = 3, top = 10 } = {}) {
  const sizes = new Map();
  for (const [rel, size] of files) {
    const parts = rel.split("/");
    for (let d = 1; d <= Math.min(depth, parts.length - 1); d++) {
      const key = parts.slice(0, d).join("/");
      sizes.set(key, (sizes.get(key) ?? 0) + size);
    }
  }
  return [...sizes].filter(([k]) => k.split("/").length === depth || !k.includes("/")).sort((a, b) => b[1] - a[1]).slice(0, top);
}

// ------------------------------------------------------------ read-only smoke

/** path → "type:size:mtime" for everything under root (files, folders, links). */
export function snapshot(root) {
  const out = new Map();
  walk(root, (full, rel, entry) => {
    const st = lstatSync(full);
    const kind = entry.isSymbolicLink() ? "l" : entry.isDirectory() ? "d" : "f";
    out.set(rel, kind === "d" ? "d" : `${kind}:${st.size}:${st.mtimeMs}`);
    return true;
  });
  return out;
}

/** Created, removed and changed paths between two snapshots. */
export function diffSnapshots(before, after) {
  const created = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
  return { created, removed, changed };
}
