// Record the licences of the code wheels link statically into their native
// modules (make agent-static-licenses; run it when a Hermes sync moves a wheel
// that stage-agent.mjs then names, and review the result before committing).
//
// A wheel's dist-info holds its own project's licence only. Rust extension
// modules (pydantic-core, jiter, cryptography, nemo-relay, resvg-py, ...) also
// carry every crate they were built from and the Rust standard library, and a
// few wheels link a C library in (cryptography: OpenSSL; cffi: libffi;
// ruamel.yaml.clib: libyaml). Their MIT, BSD, ISC and Apache notices must ship
// with the binaries. For every desktop target this script installs the wheels
// of Hermes' uv.lock the way stage-agent.mjs does (uv pip install --target
// --python-platform, nothing built), reads the crates each native binary names
// (stage-agent-lib.mjs rustCrates), then for each crate downloads its .crate
// from crates.io (sha256 checked against the crates.io index) and keeps its
// licence files and Cargo.toml licence. It writes
//
//   apps/agent/packaging/licenses/static/
//     <normalized dist>-<version>.json   targets, Rust standard library, crates, C components
//     texts/<id>.txt                     every licence text once, by content hash
//
// The C libraries are listed by hand in static/components.json (which text,
// from where, and why the library is linked in). stage-agent.mjs adds the
// records to THIRD_PARTY_LICENSES and fails when a staged binary links a
// crate its record lacks, or a distribution that links Rust code or is in
// components.json has no record for its exact version.
//
// A target uv.lock has no wheel for (cryptography 50 has none for darwin-x64)
// is skipped with a warning: stage-agent.mjs could not stage it either.
// Downloads (wheels into uv's cache, crates into apps/web/.cache/agent/crates/,
// deleted at the end) are a few hundred MB. Needs uv and tar.
//
//   node electron/static-licenses.mjs

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadFile, makefileVar, makeWritable, nativeBinaries, normalizeDist, parseExtras, pipInstallFlags, walk } from "./stage-agent-lib.mjs";
import { TARGETS } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(webRoot, "..", "..");
const agentSrc = path.join(repoRoot, "apps", "agent");
const hermesSrc = path.join(agentSrc, "hermes");
export const staticRoot = path.join(agentSrc, "packaging", "licenses", "static");
const work = path.join(webRoot, ".cache", "agent", "static-licenses");

/** uv's --python-platform for the targets pipInstallFlags leaves to the host (Linux has its glibc floor there). */
const PLATFORM_TRIPLE = {
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};

/** SPDX licence-list texts for a crate that ships no licence file (pinned release). */
const SPDX_TEXTS = "https://raw.githubusercontent.com/spdx/license-list-data/v3.25.0/text";
const RUST_STD = "MIT OR Apache-2.0";
const CRATE_LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)/i;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1048576, ...opts });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  return r;
}

const textId = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Stores a licence text once under texts/, LF line ends; returns its id. */
function storeText(texts, raw) {
  const text = `${raw.replace(/\r\n?/g, "\n").replace(/\s+$/, "")}\n`;
  const id = textId(text);
  texts.set(id, text);
  return id;
}

async function fetchText(url) {
  const file = path.join(work, "fetch", createHash("sha256").update(url).digest("hex").slice(0, 16));
  await downloadFile(url, file);
  const text = readFileSync(file, "utf8");
  rmSync(file, { force: true });
  return text;
}

/** crates.io sparse index path of a crate name. */
export function indexPath(name) {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

/** [package] license, license-file and authors of a published (normalized) Cargo.toml. */
export function cargoPackage(toml) {
  const start = toml.search(/^\[package\]\s*$/m);
  const rest = start < 0 ? "" : toml.slice(start).replace(/^\[package\]\s*$/m, "");
  const end = rest.search(/^\[/m);
  const pkg = end < 0 ? rest : rest.slice(0, end);
  const str = (key) => new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(pkg)?.[1] ?? "";
  const authors = /^authors\s*=\s*\[([\s\S]*?)\]/m.exec(pkg)?.[1] ?? "";
  return { license: str("license"), licenseFile: str("license-file"), authors: [...authors.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) };
}

/** SPDX ids and exceptions named in a licence expression ("MIT OR Apache-2.0", "MIT/Apache-2.0", "Apache-2.0 WITH LLVM-exception"). */
export function spdxIds(expression) {
  return [...new Set(expression.split(/\s+(?:OR|AND|WITH)\s+|[()/]/).map((s) => s.trim().replace(/\+$/, "")).filter(Boolean))];
}

async function crateLicence(name, version, texts) {
  const index = await fetchText(`https://index.crates.io/${indexPath(name)}`);
  const entry = index
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((e) => e.vers === version);
  if (!entry) throw new Error(`crates.io has no ${name} ${version}`);
  const crate = path.join(work, "crates", `${name}-${version}.crate`);
  await downloadFile(`https://static.crates.io/crates/${name}/${name}-${version}.crate`, crate);
  const sum = createHash("sha256").update(readFileSync(crate)).digest("hex");
  if (sum !== entry.cksum) throw new Error(`${name}-${version}.crate: sha256 ${sum}, the crates.io index says ${entry.cksum}`);
  const out = path.join(work, "x", `${name}-${version}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const r = run("tar", ["-xzf", crate, "-C", out]);
  if (r.status !== 0) throw new Error(`tar -xzf ${name}-${version}.crate failed: ${r.stderr}`);
  const root = path.join(out, `${name}-${version}`);
  const pkg = cargoPackage(readFileSync(path.join(root, "Cargo.toml"), "utf8"));
  const found = new Map();
  const add = (rel) => {
    const full = path.join(root, rel);
    if (existsSync(full) && !found.has(rel)) found.set(rel, readFileSync(full, "utf8"));
  };
  if (pkg.licenseFile) add(pkg.licenseFile);
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && CRATE_LICENSE_FILE.test(e.name)) add(e.name);
    if (e.isDirectory() && /^licen[cs]es?$/i.test(e.name)) {
      walk(path.join(root, e.name), (_full, rel, d) => {
        if (d.isFile()) add(`${e.name}/${rel}`);
        return true;
      });
    }
  }
  const files = [...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rel, text]) => ({ rel, text: storeText(texts, text) }));
  if (files.length === 0) {
    // No licence file in the crate: the standard texts of its expression, under its authors' names.
    const ids = spdxIds(pkg.license);
    if (ids.length === 0) throw new Error(`${name} ${version} has neither a licence file nor a licence expression; record it by hand`);
    const owners = pkg.authors.length ? pkg.authors.join(", ") : `the ${name} developers`;
    for (const id of ids) {
      const body = await fetchText(`${SPDX_TEXTS}/${id}.txt`);
      const head = `${name} ${version} ships no licence file. Its Cargo.toml says license = "${pkg.license}"; authors: ${owners}.\nStandard text of ${id} (SPDX license-list-data v3.25.0):\n\n`;
      files.push({ rel: `SPDX ${id} (no licence file in the crate)`, text: storeText(texts, head + body) });
    }
  }
  rmSync(out, { recursive: true, force: true });
  rmSync(crate, { force: true });
  return { name, version, license: pkg.license, files };
}

function requirements() {
  const extras = parseExtras(readFileSync(path.join(agentSrc, ".hermes-sync", "extras.txt"), "utf8"));
  const args = ["export", "--frozen", "--no-dev", "--no-emit-project", "--format", "requirements-txt"];
  for (const extra of extras) args.push("--extra", extra);
  const exp = run("uv", args, { cwd: hermesSrc });
  if (exp.status !== 0) throw new Error(`uv export failed (exit ${exp.status}):\n${exp.stderr}`);
  const file = path.join(work, "requirements.txt");
  writeFileSync(file, exp.stdout);
  return file;
}

/** Installs `key`'s wheels into a scratch folder and returns what its native binaries link. */
function scanTarget(key, req, pythonVersion, components) {
  const site = path.join(work, "site", key);
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  let flags = pipInstallFlags(key);
  if (!flags.includes("--python-platform")) {
    if (!PLATFORM_TRIPLE[key]) throw new Error(`no uv --python-platform for ${key}`);
    flags = [...flags, "--python-platform", PLATFORM_TRIPLE[key]];
  }
  const r = run("uv", ["pip", "install", "--target", site, "--python-version", pythonVersion, ...flags, "-r", req], { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    // A target uv.lock has no wheel for cannot be staged either (stage-agent.mjs installs with --no-build).
    console.warn(`static-licenses ${key}: skipped, uv pip install failed (exit ${r.status}), so this target cannot be staged:\n  ${r.stderr.trim().split("\n").slice(-6).join("\n  ")}`);
    rmSync(site, { recursive: true, force: true });
    return null;
  }
  const { dists } = nativeBinaries(site);
  for (const d of dists) {
    d.versions = {};
    for (const c of components[normalizeDist(d.name)] ?? []) {
      if (!c.detect) continue;
      const re = new RegExp(c.detect);
      for (const b of d.binaries) {
        const m = re.exec(readFileSync(path.join(site, b.rel)).toString("latin1"));
        if (m) (d.versions[c.name] ??= new Set()).add(m[1]);
      }
    }
  }
  makeWritable(site);
  rmSync(site, { recursive: true, force: true });
  return dists;
}

async function main() {
  const pythonVersion = makefileVar(readFileSync(path.join(repoRoot, "Makefile"), "utf8"), "AGENT_PYTHON_VERSION");
  const config = JSON.parse(readFileSync(path.join(staticRoot, "components.json"), "utf8"));
  const components = Object.fromEntries(Object.entries(config).filter(([k]) => !k.startsWith("_")));
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const req = requirements();
    const merged = new Map();
    const skipped = [];
    for (const key of Object.keys(TARGETS)) {
      const dists = scanTarget(key, req, pythonVersion, components);
      if (!dists) {
        skipped.push(key);
        continue;
      }
      let linked = 0;
      for (const d of dists) {
        const crates = d.binaries.flatMap((b) => b.crates);
        const rustc = d.binaries.flatMap((b) => b.rustc);
        const git = d.binaries.flatMap((b) => b.git.map((g) => `${b.rel}: ${g}`));
        if (git.length) throw new Error(`${d.name} ${d.version} on ${key} links crates from git checkouts (${git.join(", ")}); record them by hand`);
        if (!crates.length && !rustc.length && !components[normalizeDist(d.name)]) continue;
        const m = merged.get(d.key) ?? { name: d.name, version: d.version, key: d.key, targets: new Set(), crates: new Set(), rustc: new Set(), versions: {} };
        m.targets.add(key);
        for (const c of crates) m.crates.add(c);
        for (const c of rustc) m.rustc.add(c);
        for (const [n, vs] of Object.entries(d.versions)) for (const v of vs) (m.versions[n] ??= new Set()).add(v);
        merged.set(d.key, m);
        linked += crates.length ? 1 : 0;
      }
      console.log(`static-licenses ${key}: ${dists.length} distributions with native code, ${linked} link Rust crates`);
    }

    if (skipped.length === Object.keys(TARGETS).length) throw new Error("no target could be installed");
    if (skipped.length) console.warn(`static-licenses: not recorded for ${skipped.join(", ")} (no wheels for them in uv.lock)`);
    const texts = new Map();
    const crateCache = new Map();
    const stdTexts = new Map();
    const records = [];
    for (const m of [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const crates = [];
      for (const id of [...m.crates].sort()) {
        if (!crateCache.has(id)) {
          const [name, version] = id.split("@");
          crateCache.set(id, await crateLicence(name, version, texts));
        }
        crates.push(crateCache.get(id));
      }
      let rustStd = null;
      if (m.rustc.size) {
        const rustc = [...m.rustc].sort();
        const files = [];
        for (const rel of ["COPYRIGHT", "LICENSE-APACHE", "LICENSE-MIT"]) {
          const url = `https://raw.githubusercontent.com/rust-lang/rust/${rustc[0]}/${rel}`;
          if (!stdTexts.has(url)) stdTexts.set(url, storeText(texts, await fetchText(url)));
          files.push({ rel, text: stdTexts.get(url) });
        }
        rustStd = { rustc, license: RUST_STD, source: `https://github.com/rust-lang/rust/tree/${rustc[0]}`, texts: files };
      }
      const comps = [];
      for (const c of components[normalizeDist(m.name)] ?? []) {
        const versions = c.detect ? [...(m.versions[c.name] ?? [])].sort() : [c.version];
        if (versions.length === 0) throw new Error(`${m.name} ${m.version}: components.json's ${c.name} pattern ${c.detect} matched no binary; check the wheel and the entry`);
        for (const version of versions) {
          const url = c.text.replace("{version}", version);
          comps.push({ name: c.name, version, license: c.license, why: c.why, source: url, files: [{ rel: path.posix.basename(new URL(url).pathname), text: storeText(texts, await fetchText(url)) }] });
        }
      }
      const record = { dist: m.name, version: m.version, targets: [...m.targets].sort(), rustStd, crates, components: comps };
      records.push(record);
      console.log(`static-licenses: ${m.key}: ${crates.length} crates${rustStd ? ", Rust standard library" : ""}${comps.length ? `, ${comps.map((c) => `${c.name} ${c.version}`).join(", ")}` : ""}`);
    }

    // The records and texts are this script's output: what it did not write now goes.
    mkdirSync(path.join(staticRoot, "texts"), { recursive: true });
    for (const f of readdirSync(staticRoot)) if (f.endsWith(".json") && f !== "components.json") rmSync(path.join(staticRoot, f));
    for (const f of readdirSync(path.join(staticRoot, "texts"))) rmSync(path.join(staticRoot, "texts", f));
    for (const [id, text] of texts) writeFileSync(path.join(staticRoot, "texts", `${id}.txt`), text);
    for (const r of records) {
      writeFileSync(path.join(staticRoot, `${normalizeDist(r.dist)}-${r.version}.json`), `${JSON.stringify(r, null, 2)}\n`);
    }
    console.log(`static-licenses: ${records.length} records, ${crateCache.size} crates, ${texts.size} texts → ${path.relative(repoRoot, staticRoot)}`);
  } finally {
    if (existsSync(work)) makeWritable(work);
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("static-licenses.mjs takes no arguments: it records every desktop target");
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
