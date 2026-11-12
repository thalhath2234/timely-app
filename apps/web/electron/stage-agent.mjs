// Stage the agent runtime for the host target into .electron-agent/<stageDir>/
// (plan 11.4; docs/plans/2026-11-13-phase3b-work-packages.md "stage-agent"):
//
//   agent/
//     boot.py               apps/agent/packaging/boot.py (python -I boot.py <command>)
//     python/               python-build-standalone from apps/agent/hermes/pm/lock.json, trimmed
//     app/hermes/           apps/agent/hermes: shipped skills only, locales/en.yaml only
//     app/timely_agent/     apps/agent/timely_agent
//     app/skills/           apps/agent/skills, files 0444 and folders 0555 (empty until the timely skill ships)
//     app/site-packages/    uv pip install --target from Hermes' uv.lock with .hermes-sync/extras.txt
//     app/.hermes-sync/policy/
//     NOTICE, THIRD_PARTY_LICENSES, MANIFEST.json, .staged-<hash>
//
//   node electron/stage-agent.mjs                    # the host target (TIMELY_TARGETS must name only it;
//                                                    # any other target fails before anything is staged)
//   node electron/stage-agent.mjs --target linux-x64
//   node electron/stage-agent.mjs --host             # the host target, whatever TIMELY_TARGETS says
//   node electron/stage-agent.mjs --clean            # delete every staged runtime
//
// Only node: builtins: CI runners and the Docker build stage run it without
// pnpm. Needs uv on PATH. The interpreter download is cached in .cache/agent/.
// A matching .staged-<hash> marker skips the download, trim and install; the
// source copy, seed check, compileall and checks always run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_PLATFORM,
  MAX_PATH_CHARS,
  pipInstallFlags,
  assertHostTargets,
  checkTree,
  collectLicenses,
  copyInto,
  copyleftReview,
  dropLongBytecode,
  downloadFile,
  cpythonLicense,
  hermesCopyFilter,
  importCheckSource,
  importsStdlibTest,
  interpreterLicenses,
  largestFolders,
  listTree,
  makeReadOnly,
  makeWritable,
  makefileVar,
  markerHash,
  nativeBinaries,
  parseExtras,
  plainCopyFilter,
  pythonArtifact,
  scratchRootFor,
  selectSkills,
  sourceHash,
  skillDirs,
  trackedSkillNames,
  trackedSources,
  stagedManifest,
  staticLicenses,
  stagedPython,
  stdlibDir,
  thirdPartyLicenses,
  treeSize,
  trackedOnly,
  trimPlan,
} from "./stage-agent-lib.mjs";
import { hostTargetKey, resolveTargets } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(webRoot, "..", "..");
const agentSrc = path.join(repoRoot, "apps", "agent");
const hermesSrc = path.join(agentSrc, "hermes");
export const cacheDir = path.join(webRoot, ".cache", "agent");
export const stageRoot = path.join(webRoot, ".electron-agent");
/** This checkout's scratch folder for prepare runs (scratchRootFor). */
export const scratchRoot = scratchRootFor(repoRoot);

const MB = 1048576;
const mb = (bytes) => `${(bytes / MB).toFixed(1)} MiB`;

function log(target, msg) {
  console.log(`stage-agent ${target.key}: ${msg}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * MB, ...opts });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  return r;
}

function removeTree(dir) {
  if (!existsSync(dir)) return;
  makeWritable(dir);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- download

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  console.log(`downloading ${url}`);
  await downloadFile(url, dest);
}

async function fetchPython(artifact) {
  const file = path.join(cacheDir, decodeURIComponent(path.posix.basename(new URL(artifact.url).pathname)));
  if (!existsSync(file)) await download(artifact.url, file);
  const actual = sha256File(file);
  if (actual !== artifact.sha256) {
    rmSync(file, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${path.basename(file)}\n  expected ${artifact.sha256}\n  actual   ${actual}\n` +
        "The cached file was deleted; re-run to download it again. If it keeps failing, the upstream artefact changed.",
    );
  }
  return file;
}

// On Windows, the system bsdtar: Git Bash's GNU tar reads "C:\..." as host:path.
function tarCommand() {
  if (process.platform === "win32") {
    const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (existsSync(systemTar)) return systemTar;
  }
  return "tar";
}

function extract(archive, dest) {
  const r = run(tarCommand(), ["-xzf", archive, "-C", dest]);
  if (r.status !== 0) throw new Error(`tar -xzf ${path.basename(archive)} failed (exit ${r.status}).\n${r.stderr}`);
  const top = readdirSync(dest);
  if (top.length !== 1 || top[0] !== "python") {
    throw new Error(`${path.basename(archive)} should hold one python/ folder; it holds ${top.join(", ")}`);
  }
}

// ---------------------------------------------------------------- steps 2-4

function trimInterpreter(target, pythonDir) {
  const { drop, tests } = trimPlan(pythonDir);
  let bytes = 0;
  for (const rel of drop) {
    const full = path.join(pythonDir, rel);
    bytes += treeSize(full) || 0;
    rmSync(full, { recursive: true, force: true });
  }
  for (const rel of tests) {
    const size = treeSize(path.join(pythonDir, rel));
    const importer = importsStdlibTest([hermesSrc, path.join(agentSrc, "timely_agent")]);
    if (importer) {
      log(target, `kept python/${rel} (${mb(size)}): ${importer} imports the stdlib test package`);
    } else {
      log(target, `dropped python/${rel} (${mb(size)}; nothing staged imports it)`);
      rmSync(path.join(pythonDir, rel), { recursive: true, force: true });
      bytes += size;
    }
  }
  if (tests.length === 0) log(target, "the interpreter has no stdlib test package (0 MB to drop)");
  log(target, `trimmed ${drop.length} interpreter entries (${mb(bytes)}): ${drop.join(", ")}`);
  cpythonLicense(pythonDir); // throws when the trim took the licence
}

function installSitePackages(target, python, site, extras) {
  const uv = run("uv", ["--version"]);
  if (uv.status !== 0) {
    throw new Error("uv was not found on PATH. Install it (https://docs.astral.sh/uv/getting-started/installation/).");
  }
  const exportArgs = ["export", "--frozen", "--no-dev", "--no-emit-project", "--format", "requirements-txt"];
  for (const extra of extras) exportArgs.push("--extra", extra);
  const exp = run("uv", exportArgs, { cwd: hermesSrc });
  if (exp.status !== 0) throw new Error(`uv export failed (exit ${exp.status}):\n${exp.stderr}`);
  mkdirSync(cacheDir, { recursive: true });
  const req = path.join(cacheDir, `requirements-${target.key}.txt`);
  writeFileSync(req, exp.stdout);
  const args = ["pip", "install", "--python", python, "--target", site, ...pipInstallFlags(target.key), "-r", req];
  const r = run("uv", args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(
      `uv pip install failed (exit ${r.status}). With --no-build a dependency that has no wheel for ${target.key} ` +
        "fails here; building it from source is a decision for the coordinator, not a default.\n" +
        r.stderr.split("\n").slice(-30).join("\n"),
    );
  }
  // Console scripts carry absolute build-machine shebangs; the worker never runs them.
  for (const name of ["bin", "Scripts", ".lock"]) rmSync(path.join(site, name), { recursive: true, force: true });
  const installed = (r.stderr.match(/^ \+ /gm) ?? []).length;
  log(target, `installed ${installed} distributions from uv.lock (extras: ${extras.join(", ")})`);
}

// ---------------------------------------------------------------- step 5

function copySource(target, out, selection, tracked, trackedFrom) {
  const app = path.join(out, "app");
  mkdirSync(app, { recursive: true });
  for (const rel of ["hermes", "timely_agent", "skills", ".hermes-sync"]) removeTree(path.join(app, rel));
  for (const rel of ["boot.py", "NOTICE", "THIRD_PARTY_LICENSES", "MANIFEST.json"]) rmSync(path.join(out, rel), { force: true });

  // Only what git tracks is copied, so an untracked or ignored .env, credential or virtualenv
  // in the working tree never ships (checkTree fails one that gets in anyway). The Docker
  // stage has no .git and reads the list make agent-tracked-list wrote instead.
  const skipped = [];
  // Explicit filters keep cpSync on its JS copier (Node's native path aborts on Windows);
  // verbatimSymlinks keeps a relative link relative instead of rewriting it to this machine.
  const opts = (filter) => ({ recursive: true, filter: trackedOnly(filter, { repoRoot, tracked, skipped }), verbatimSymlinks: true });
  cpSync(hermesSrc, path.join(app, "hermes"), opts(hermesCopyFilter(hermesSrc, selection)));
  const locales = readdirSync(path.join(app, "hermes", "locales"));
  if (locales.length !== 1 || locales[0] !== "en.yaml") {
    throw new Error(`app/hermes/locales must hold only en.yaml (owner answer Q-1.4); it holds ${locales.join(", ")}`);
  }
  for (const keep of ["plugin-catalog", "HERMES_UPSTREAM.json", "pm/lock.json", "LICENSE"]) {
    if (!existsSync(path.join(app, "hermes", keep))) throw new Error(`app/hermes/${keep} is missing after the copy`);
  }
  const timelyAgent = path.join(agentSrc, "timely_agent");
  cpSync(timelyAgent, path.join(app, "timely_agent"), opts(plainCopyFilter(timelyAgent)));
  const skillsSrc = path.join(agentSrc, "skills");
  const skillsOut = path.join(app, "skills");
  // An empty folder when apps/agent/skills is missing or git tracks nothing in it yet.
  copyInto(skillsSrc, skillsOut, opts(plainCopyFilter(skillsSrc)));
  makeReadOnly(skillsOut);
  const policySrc = path.join(agentSrc, ".hermes-sync", "policy");
  cpSync(policySrc, path.join(app, ".hermes-sync", "policy"), opts(plainCopyFilter(policySrc)));
  copyFileSync(path.join(agentSrc, "packaging", "boot.py"), path.join(out, "boot.py"));
  copyFileSync(path.join(agentSrc, "NOTICE"), path.join(out, "NOTICE"));
  if (skipped.length) {
    log(target, `left out ${skipped.length} untracked or ignored path(s) git does not track: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? ", ..." : ""}`);
  }
  if (trackedFrom !== "git") log(target, `no git checkout: copied only the files ${trackedFrom} lists`);
  log(
    target,
    `copied the source: ${selection.seed.length} bundled skills (seed set), ${selection.optional.length} offered optional skills, ` +
      `${Object.entries(selection.excluded).map(([k, v]) => `${v.length} ${k}`).join(", ")} left out`,
  );
}

// ---------------------------------------------------------------- steps 6-8

/** Environment for Python run by the stage: nothing of the developer's (no HERMES_*, keys or PYTHON*). */
function cleanEnv(home) {
  const env = { HOME: home, USERPROFILE: home, LANG: "C.UTF-8", PYTHONUTF8: "1" };
  // Windows names are case-insensitive: copy each one once, under the name it has.
  const keep = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TEMP", "TMP"]);
  for (const [name, value] of Object.entries(process.env)) {
    if (keep.has(name.toUpperCase()) && value !== undefined) env[name] = value;
  }
  return env;
}

function lastJsonLine(stdout) {
  const line = stdout.trim().split(/\r?\n/).pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function seedCheck(target, out, python, selection) {
  const scratch = path.join(scratchRoot, `prepare-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(scratch, "home"), { recursive: true });
  try {
    const started = Date.now();
    // -B: nothing is compiled into the stage before step 7 does it on purpose.
    const r = run(python, ["-I", "-B", path.join(out, "boot.py"), "prepare", "--agent-dir", path.join(scratch, "agent")], {
      cwd: scratch,
      env: cleanEnv(path.join(scratch, "home")),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const answer = lastJsonLine(r.stdout);
    if (r.status !== 0 || !answer?.ok) {
      throw new Error(`boot.py prepare failed (exit ${r.status}): ${answer?.error ?? ""}\n${r.stderr.split("\n").slice(-30).join("\n")}`);
    }
    const seed = answer.seed ?? {};
    const seededDirs = skillDirs(answer.seed_skills_dir).length;
    if (seed.unreviewed !== 0 || seed.seeded !== selection.seed.length) {
      throw new Error(
        `seed check: prepare seeded ${seed.seeded} and found ${seed.unreviewed} unreviewed, the stage copied ` +
          `${selection.seed.length} skills. A copied skill whose tree no longer matches skills-reviewed.json needs ` +
          "make hermes-skills-review.",
      );
    }
    log(
      target,
      `seed check: prepare built the seed tree (${seed.seeded} skills, ${seededDirs} folders) and the read-only Timely skills copy ` +
        `in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } finally {
    removeTree(scratch);
  }
}

/** The MCP SDK (and on Windows pywin32 and portalocker) import through boot.py's sys.path. */
export function checkImports(root, python, env) {
  const bootPy = path.join(root, "app", "timely_agent", "boot.py");
  const r = run(python, ["-I", "-B", "-c", importCheckSource(bootPy)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const answer = lastJsonLine(r.stdout);
  if (r.status !== 0 || !answer || Object.keys(answer.failed ?? {}).length) {
    const failed = Object.entries(answer?.failed ?? {}).map(([name, why]) => `${name}: ${why}`);
    throw new Error(
      `the staged runtime cannot import what it ships (exit ${r.status}):\n  ${failed.join("\n  ")}\n${r.stderr.split("\n").slice(-20).join("\n")}`,
    );
  }
  return answer.checked;
}

function compileAll(target, out, python) {
  const app = path.join(out, "app");
  const stdlib = stdlibDir(path.join(out, "python"));
  // Skill scripts are copied into each account's home by prepare and never imported from here.
  const skip = String.raw`[\\/]app[\\/](hermes[\\/](optional-)?skills|skills)[\\/]`;
  // -B: importing compileall itself must not leave timestamp pycs that hold this
  // machine's path; -f: rewrite any pyc already there as unchecked-hash.
  const args = ["-I", "-B", "-m", "compileall", "-f", "-q", "-j0", "--invalidation-mode", "unchecked-hash", "-s", out, "-x", skip, app, stdlib];
  const started = Date.now();
  const r = run(python, args, { cwd: out, env: cleanEnv(os.homedir()) });
  if (r.status !== 0) throw new Error(`compileall failed (exit ${r.status}):\n${(r.stdout + r.stderr).split("\n").slice(-40).join("\n")}`);
  log(target, `compiled bytecode (unchecked-hash) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  // A .pyc over the path limit (plan 11.4) is dropped and its module imports from source.
  const dropped = dropLongBytecode(out, MAX_PATH_CHARS);
  if (dropped.length) {
    log(target, `left ${dropped.length} module(s) uncompiled, their bytecode path is over ${MAX_PATH_CHARS} characters: ${dropped.join(", ")}`);
  }
}

function checkInterpreter(target, python) {
  const r = run(python, ["-I", "-B", "-c", "import json, platform, sys; print(json.dumps([sys.platform, platform.machine(), sys.version.split()[0]]))"]);
  const got = lastJsonLine(r.stdout);
  const want = EXPECTED_PLATFORM[target.key];
  if (r.status !== 0 || !got || !want || got[0] !== want[0] || got[1] !== want[1]) {
    throw new Error(`the staged interpreter reports ${JSON.stringify(got)} (exit ${r.status}), expected ${JSON.stringify(want)} for ${target.key}\n${r.stderr}`);
  }
  return got[2];
}

// ---------------------------------------------------------------- main

/** What the marker and the manifest record about the checkout: the Python pin, uv.lock, extras and the Hermes tag. */
function stageInputs() {
  const makefile = readFileSync(path.join(repoRoot, "Makefile"), "utf8");
  return {
    expectedVersion: makefileVar(makefile, "AGENT_PYTHON_VERSION"),
    lock: JSON.parse(readFileSync(path.join(hermesSrc, "pm", "lock.json"), "utf8")),
    extras: parseExtras(readFileSync(path.join(agentSrc, ".hermes-sync", "extras.txt"), "utf8")),
    uvLock: readFileSync(path.join(hermesSrc, "uv.lock")),
    hermesTag: JSON.parse(readFileSync(path.join(hermesSrc, "HERMES_UPSTREAM.json"), "utf8")).tag ?? "",
  };
}

/** The `.staged-<hash>` marker name for `key` from stageInputs(). */
function stageMarker({ lock, expectedVersion, uvLock, extras }, key) {
  const artifact = pythonArtifact(lock, key, expectedVersion);
  return `.staged-${markerHash({ pythonEntry: artifact.entry, uvLock, extras, target: key })}`;
}

function clean() {
  removeTree(stageRoot);
  removeTree(scratchRoot);
  console.log(`removed ${path.relative(repoRoot, stageRoot)} and ${scratchRoot} (the download cache ${path.relative(repoRoot, cacheDir)} is kept)`);
}

export async function stageAgent(targets = resolveTargets()) {
  assertHostTargets(targets.map((t) => t.key), hostTargetKey());
  const inputs = stageInputs();
  const { lock, extras, expectedVersion, hermesTag } = inputs;
  const policy = path.join(agentSrc, ".hermes-sync", "policy");
  const reviewed = JSON.parse(readFileSync(path.join(policy, "skills-reviewed.json"), "utf8"));
  const denied = JSON.parse(readFileSync(path.join(policy, "skills-denied.json"), "utf8"));
  // The Docker stage has no .git: the list make agent-tracked-list wrote stands in (trackedSources).
  const { tracked, from: trackedFrom } = trackedSources(repoRoot);
  const overrides = trackedSkillNames(path.join(agentSrc, "skills", "overrides"), { repoRoot, tracked });
  const sources = sourceHash(repoRoot, tracked);

  const results = [];
  for (const target of targets) {
    const started = Date.now();
    const artifact = pythonArtifact(lock, target.key, expectedVersion);
    const out = path.join(stageRoot, target.stageDir);
    const marker = stageMarker(inputs, target.key);
    const python = stagedPython(out);
    const site = path.join(out, "app", "site-packages");

    if (existsSync(path.join(out, marker)) && existsSync(python) && existsSync(site)) {
      log(target, `${marker} matches: reusing the interpreter and site-packages (download and install skipped)`);
    } else {
      removeTree(out);
      mkdirSync(out, { recursive: true });
      const archive = await fetchPython(artifact);
      extract(archive, out);
      log(target, `Python ${artifact.version} from ${path.basename(archive)} (sha256 verified)`);
      trimInterpreter(target, path.join(out, "python"));
      mkdirSync(site, { recursive: true });
      installSitePackages(target, python, site, extras);
      for (const name of readdirSync(out)) if (name.startsWith(".staged-")) rmSync(path.join(out, name));
      writeFileSync(path.join(out, marker), `${new Date().toISOString()}\n`);
    }

    const selection = selectSkills({ hermesDir: hermesSrc, reviewed, denied, overrides });
    if (selection.seed.length === 0) {
      throw new Error("no bundled skill would be seeded: apps/agent/hermes/skills or the reviewed list is missing");
    }
    copySource(target, out, selection, tracked, trackedFrom);
    const pyVersion = checkInterpreter(target, python);
    seedCheck(target, out, python, selection);
    log(target, `imports: ${checkImports(out, python, cleanEnv(os.homedir())).join(", ")}`);
    compileAll(target, out, python);

    // Licences first, so a failed tree check still reports every problem at once.
    const licensesDir = path.join(agentSrc, "packaging", "licenses");
    const licenceTexts = JSON.parse(readFileSync(path.join(licensesDir, "dists.json"), "utf8"));
    const { dists, missing } = collectLicenses(site, { licensesDir, overrides: licenceTexts });
    const review = copyleftReview(dists, JSON.parse(readFileSync(path.join(licensesDir, "copyleft.json"), "utf8")));
    const gnuDir = path.join(licensesDir, "gnu");
    const gnuTexts = Object.fromEntries(readdirSync(gnuDir).map((f) => [f.replace(/\.txt$/, ""), readFileSync(path.join(gnuDir, f), "utf8")]));
    const staticDir = path.join(licensesDir, "static");
    const components = Object.fromEntries(
      Object.entries(JSON.parse(readFileSync(path.join(staticDir, "components.json"), "utf8"))).filter(([k]) => !k.startsWith("_")),
    );
    const native = nativeBinaries(site);
    const statics = staticLicenses(native.dists, staticDir, { components });
    const interpreter = interpreterLicenses(path.join(agentSrc, "packaging", "python-licenses"), artifact.version, target.key);
    const pythonDir = path.join(out, "python");
    writeFileSync(
      path.join(out, "THIRD_PARTY_LICENSES"),
      thirdPartyLicenses({
        cpython: readFileSync(path.join(pythonDir, cpythonLicense(pythonDir)), "utf8"),
        interpreter,
        hermes: readFileSync(path.join(hermesSrc, "LICENSE"), "utf8"),
        notice: readFileSync(path.join(agentSrc, "NOTICE"), "utf8"),
        dists,
        statics: statics.records,
        copyleft: review.listed,
        gnuTexts,
      }),
    );
    const { problems, longest } = checkTree(out, { stagePath: out });
    for (const name of missing) {
      problems.push(`no licence text (no licence file in its wheel and no entry in apps/agent/packaging/licenses/dists.json): ${name}`);
    }
    problems.push(...review.problems, ...statics.problems);
    for (const rel of native.unowned) problems.push(`native binary no distribution's RECORD lists, so its licences cannot be checked: app/site-packages/${rel}`);
    if (problems.length) {
      throw new Error(`the staged runtime cannot ship (${problems.length} problems):\n  ${problems.slice(0, 40).join("\n  ")}`);
    }
    log(
      target,
      `checks passed: ${dists.length} distributions licensed, ${interpreter.length} interpreter libraries, ` +
        `${statics.records.length} distributions' statically linked code (${statics.records.reduce((n, r) => n + r.record.crates.length, 0)} crates), ` +
        `${review.listed.length} reviewed GPL/LGPL distributions, no absolute or escaping symlink, no browser, ` +
        `no stage path; longest path ${longest.length}/${MAX_PATH_CHARS}: ${longest}`,
    );

    const { files, links } = listTree(out);
    const bytes = files.reduce((n, [, size]) => n + size, 0);
    const manifest = {
      target: target.key,
      python: artifact.version,
      hermesTag,
      marker,
      sources,
      files,
      links,
      totals: { files: files.length, bytes },
    };
    writeFileSync(path.join(out, "MANIFEST.json"), `${JSON.stringify(manifest)}\n`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    log(
      target,
      `staged → ${path.relative(repoRoot, out)}: ${files.length} files, ${mb(bytes)}, ${dists.length} distributions, ` +
        `Python ${pyVersion}, Hermes ${hermesTag}, ${seconds} s`,
    );
    for (const [folder, size] of largestFolders(files)) console.log(`  ${mb(size).padStart(10)}  ${folder}`);
    results.push(out);
  }
  return results;
}

function cliTargets(argv) {
  const keys = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") keys.push(...String(argv[++i] ?? "").split(","));
    else if (argv[i].startsWith("--target=")) keys.push(...argv[i].slice(9).split(","));
    else if (argv[i] === "--host") keys.push(hostTargetKey());
    else throw new Error(`unknown argument ${argv[i]} (use --target <key>, --host, --clean)`);
  }
  return resolveTargets(keys.length ? keys : undefined);
}

/**
 * pack.mjs with TIMELY_AGENT_STAGED=1 (release.yml, after the read-only smoke):
 * packs the stage that was smoked instead of staging again, which would
 * re-copy the source and recompile every module. Each target's stage must
 * have finished (MANIFEST.json for that target, its .staged marker present)
 * from the inputs the checkout has now: the same marker (uv.lock, extras,
 * Python pin), Hermes tag and apps/agent sources. A stage left over from
 * before a Hermes sync is refused, not packed.
 */
export function reuseStagedAgent(targets) {
  const inputs = stageInputs();
  const sources = sourceHash(repoRoot, trackedSources(repoRoot).tracked);
  return targets.map((target) => {
    const out = path.join(stageRoot, target.stageDir);
    const manifest = stagedManifest(out, target.key, { marker: stageMarker(inputs, target.key), hermesTag: inputs.hermesTag, sources });
    log(target, `TIMELY_AGENT_STAGED=1: packing the smoked stage (${manifest.totals.files} files, ${mb(manifest.totals.bytes)})`);
    return out;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--clean")) clean();
    else await stageAgent(cliTargets(argv));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
