// Helpers for stage-agent.mjs and smoke-agent.mjs (plan 11.4, phase 3b work
// packages "stage-agent"). Only node: builtins, so CI runners and the Docker
// build stage run them without `pnpm install`. Each helper takes its inputs
// as arguments so scripts/stage-agent.test.mjs can drive it on a fixture.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";

/** Longest path allowed relative to the agent root, counted after compileall (plan 11.4). */
export const MAX_PATH_CHARS = 150;

/**
 * Bumped when the trim list or the install command changes, so a stage made
 * by an older script is not reused through its marker.
 */
export const STAGE_FORMAT = 1;

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

/** sha256 naming the `.staged-<hash>` marker: everything steps 2-4 depend on. */
export function markerHash({ pythonEntry, uvLock, extras, target }) {
  const h = createHash("sha256");
  h.update(JSON.stringify({ format: STAGE_FORMAT, python: pythonEntry, extras, target }));
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
const TRIM = [
  /^include$/i, // C headers
  /^share$/i, // man pages, terminfo
  /^libs$/i, // Windows import libraries
  /^scripts$/i, // Windows pip.exe and friends
  /^tcl$/i, // Windows Tcl/Tk library
  /^lib\/pkgconfig$/i,
  /^lib\/(tcl|tk|itcl|thread)[0-9][^/]*$/i, // Tcl/Tk script libraries
  /^lib\/lib(tcl|tk)[^/]*$/i, // libtcl9.0.so, libtcl9tk9.0.so
  /^bin\/(pip|idle|pydoc)[^/]*$/i, // launchers of trimmed modules
  /^bin\/python[^/]*-config$/i,
  /^(lib\/python3\.\d+|lib)\/(idlelib|tkinter|turtledemo|ensurepip|turtle\.py)$/i,
  /^(lib\/python3\.\d+|lib)\/site-packages\/pip(-[^/]*)?$/i, // the interpreter's own pip
  /^(lib\/python3\.\d+\/lib-dynload|dlls)\/_tkinter[^/]*$/i,
  /^dlls\/(tcl|tk)[^/]*\.dll$/i,
  /^(tcl|tk)[0-9][^/]*\.dll$/i,
];

/** The stdlib test package, dropped only when nothing staged imports it. */
export const STDLIB_TEST = /^(lib\/python3\.\d+|lib)\/test$/i;

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
 * Whole-tree checks (plan 11.4, work packages step 8). Returns a list of
 * problems, empty when the tree may ship:
 * - a symlink with an absolute target, or one resolving outside the root;
 * - a path longer than `maxChars` relative to the root;
 * - a file holding the absolute stage path (a build-machine path that would ship);
 * - a browser: playwright/pyppeteer/Chromium in site-packages or a Chrome binary anywhere (ADR 0022).
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

/**
 * Every `*.dist-info` in site-packages with its licence metadata and the text
 * of its licence files. `missing` names distributions with neither.
 */
export function collectLicenses(sitePackages) {
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
    if (!dist.license && dist.files.length === 0) missing.push(dist.name);
    dists.push(dist);
  }
  return { dists, missing };
}

/** THIRD_PARTY_LICENSES: CPython, Hermes, Timely's NOTICE, then every distribution. */
export function thirdPartyLicenses({ cpython, hermes, notice, dists }) {
  const rule = "=".repeat(78);
  const parts = [
    "Third-party software in Timely's agent runtime (resources/agent, /app/agent).",
    "",
    rule,
    "CPython (python/), Python Software Foundation License",
    rule,
    cpython.trim(),
    "",
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
  ];
  for (const d of dists) {
    parts.push(rule, `${d.name} ${d.version} (app/site-packages/${d.dir}): ${d.license || "see licence files"}`, rule);
    for (const f of d.files) parts.push(`--- ${f.rel}`, f.text.trim(), "");
    if (d.files.length === 0) parts.push("");
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
