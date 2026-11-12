// Tests for the agent runtime staging helpers (apps/web/electron/stage-agent-lib.mjs),
// the read-only lock of smoke-agent.mjs and the packaged boot.py shim.
// make test-stage-agent

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LINUX_GLIBC_FLOOR,
  MAX_PATH_CHARS,
  PIP_INSTALL_FLAGS,
  SITE_TRIM,
  STAGE_FORMAT,
  TRIM,
  assertHostTarget,
  assertHostTargets,
  checkTree,
  collectLicenses,
  copyInto,
  copyleftReview,
  declaresCopyleft,
  downloadFile,
  fullArchiveName,
  BUNDLED_LIBRARIES,
  cpythonIncorporated,
  incorporatedLicenses,
  interpreterLicenses,
  interpreterModuleProblems,
  pythonLicenseRecord,
  cpythonLicense,
  diffSnapshots,
  dropLongBytecode,
  gitTracked,
  hermesCopyFilter,
  importCheckSource,
  importsStdlibTest,
  largestFolders,
  listTree,
  makeReadOnly,
  makeWritable,
  makefileVar,
  nativeBinaries,
  pipInstallFlags,
  rustCrates,
  staticLicenses,
  markerHash,
  parseExtras,
  parseMetadata,
  plainCopyFilter,
  pythonArtifact,
  scratchRootFor,
  selectSkills,
  siteTrimPlan,
  snapshot,
  sourceHash,
  staleTrackedList,
  stagedManifest,
  stagedPython,
  trackedSkillNames,
  trackedSources,
  stdlibDir,
  thirdPartyLicenses,
  trimPlan,
  trackedOnly,
} from "../apps/web/electron/stage-agent-lib.mjs";
import { lockTree, windowsLockCommand } from "../apps/web/electron/smoke-agent.mjs";
import { cargoPackage, indexPath, spdxIds } from "../apps/web/electron/static-licenses.mjs";
import { TARGETS } from "../apps/web/electron/targets.mjs";

const repo = path.join(import.meta.dirname, "..");
const posix = process.platform !== "win32";

function tmp(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stage-agent-test-"));
  t.after(() => {
    makeWritable(dir);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function write(root, rel, text = "x") {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
  return full;
}

function files(root) {
  return listTree(root).files.map(([rel]) => rel);
}

// ------------------------------------------------------------ lock and Makefile

test("the lock has a Python pin for every desktop target, matching the Makefile's version", () => {
  const lock = JSON.parse(readFileSync(path.join(repo, "apps/agent/hermes/pm/lock.json"), "utf8"));
  const version = makefileVar(readFileSync(path.join(repo, "Makefile"), "utf8"), "AGENT_PYTHON_VERSION");
  for (const key of Object.keys(TARGETS)) {
    const a = pythonArtifact(lock, key, version);
    assert.match(a.url, /^https:\/\/github\.com\/astral-sh\/python-build-standalone\/.*install_only\.tar\.gz$/, key);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.ok(a.version.startsWith(`${version}+`));
  }
});

test("pythonArtifact picks the target's entry and checks the version", () => {
  const lock = {
    packages: {
      python: {
        version: "3.14.9+20261021",
        artifacts: {
          "linux-x64": { url: "https://x/linux.tar.gz", sha256: "a".repeat(64) },
          "win32-x64": { url: "https://x/win.tar.gz", sha256: "b".repeat(64) },
          "darwin-arm64": { url: "https://x/mac.tar.gz", sha256: "nope" },
        },
      },
    },
  };
  assert.equal(pythonArtifact(lock, "win32-x64", "3.14.9").url, "https://x/win.tar.gz");
  assert.equal(pythonArtifact(lock, "linux-x64", "3.14.9").sha256, "a".repeat(64));
  assert.deepEqual(pythonArtifact(lock, "linux-x64", "3.14.9").entry, {
    version: "3.14.9+20261021",
    url: "https://x/linux.tar.gz",
    sha256: "a".repeat(64),
  });
  assert.throws(() => pythonArtifact(lock, "linux-x64", "3.14.8"), /AGENT_PYTHON_VERSION is 3\.14\.8/);
  assert.throws(() => pythonArtifact(lock, "linux-x64", "3.14"), /pins Python 3\.14\.9\+20261021/);
  assert.throws(() => pythonArtifact(lock, "linux-arm64", "3.14.9"), /no Python artifact for linux-arm64/);
  assert.throws(() => pythonArtifact(lock, "darwin-arm64", "3.14.9"), /no Python artifact for darwin-arm64/);
  assert.throws(() => pythonArtifact({ packages: {} }, "linux-x64", "3.14.9"), /no packages\.python/);
});

test("makefileVar reads `?=` the way ci.yml does", () => {
  assert.equal(makefileVar("A := 1\nAGENT_PYTHON_VERSION ?= 3.14.9\n", "AGENT_PYTHON_VERSION"), "3.14.9");
  assert.equal(makefileVar("AGENT_PYTHON_VERSION=3.13.1\n", "AGENT_PYTHON_VERSION"), "3.13.1");
  assert.throws(() => makefileVar("X ?= 1\n", "AGENT_PYTHON_VERSION"), /does not set AGENT_PYTHON_VERSION/);
});

test("extras parsing drops comments, blanks and spaces, like agent-install", () => {
  assert.deepEqual(parseExtras("# head\nmcp\n\n  anthropic  # why\r\n   \nexa\n"), ["mcp", "anthropic", "exa"]);
  const real = parseExtras(readFileSync(path.join(repo, "apps/agent/.hermes-sync/extras.txt"), "utf8"));
  assert.ok(real.includes("mcp") && real.includes("anthropic"), real.join());
  assert.ok(!real.some((e) => /\s|#/.test(e)));
});

test("a target that is not the host is refused with the runner to use", () => {
  assert.doesNotThrow(() => assertHostTarget("linux-x64", "linux-x64"));
  assert.throws(() => assertHostTarget("win32-x64", "linux-x64"), /cannot stage win32-x64 on linux-x64.*stage win32-x64 on a Windows x64 runner/s);
  assert.throws(() => assertHostTarget("linux-arm64", "linux-x64"), /on a Linux arm64 runner/);
});

test("a target list naming another OS is refused as a whole, before anything is staged", () => {
  assert.doesNotThrow(() => assertHostTargets(["linux-x64"], "linux-x64"));
  assert.throws(() => assertHostTargets(["linux-x64", "win32-x64"], "linux-x64"), /cannot stage win32-x64 on linux-x64.*Nothing was staged/s);
  assert.throws(() => assertHostTargets(["darwin-arm64", "darwin-x64"], "darwin-arm64"), /cannot stage darwin-x64/);
  assert.throws(() => assertHostTargets(["win32-x64", "darwin-x64", "linux-x64"], "linux-x64"), /win32-x64.*\(and darwin-x64\)/s);
});

test("an Intel Mac is refused before anything is staged or built: cryptography 50 has no macOS x86_64 wheel", () => {
  assert.throws(() => assertHostTargets(["darwin-x64"], "darwin-x64"), /cannot stage darwin-x64\. Intel Macs cannot ship the agent runtime: cryptography 50\.0\.2 .*no macOS x86_64 wheel.*Nothing was staged/s);
  assert.doesNotThrow(() => assertHostTargets(["darwin-arm64"], "darwin-arm64"));
  // The reason holds for the pinned lock: no cryptography wheel for macOS x86_64.
  const lock = readFileSync(path.join(repo, "apps/agent/hermes/uv.lock"), "utf8");
  const crypto = /\[\[package\]\]\nname = "cryptography"\nversion = "([^"]+)"[\s\S]*?(?=\n\[\[package\]\])/.exec(lock);
  assert.equal(crypto?.[1], "50.0.2", "cryptography moved: check whether darwin-x64 has a wheel now and update UNSTAGEABLE_TARGETS");
  assert.doesNotMatch(crypto[0], /macosx_[\d_]+_(x86_64|universal2)\.whl/);
  // pack.mjs checks before the Next build (the test above), and stage-agent through stageAgent.
  assert.match(readFileSync(path.join(repo, "apps/web/electron/stage-agent.mjs"), "utf8"), /assertHostTargets\(targets\.map/);
});

test("make stage-desktop and pnpm electron:stage stage the agent for the host only, whatever TIMELY_TARGETS says", () => {
  const make = readFileSync(path.join(repo, "Makefile"), "utf8");
  const recipe = /^stage-desktop:.*\n((?:\t.*\n)+)/m.exec(make)?.[1] ?? "";
  assert.match(recipe, /node \$\(WEB\)\/electron\/stage-agent\.mjs --host\n/);
  const scripts = JSON.parse(readFileSync(path.join(repo, "apps/web/package.json"), "utf8")).scripts;
  assert.match(scripts["electron:stage"], /node electron\/stage-agent\.mjs --host$/);
  const r = spawnSync(process.execPath, [path.join(repo, "apps/web/electron/stage-agent.mjs"), "--bogus"], { encoding: "utf8" });
  assert.match(r.stderr, /--host/, "the CLI knows --host");
  const pack = readFileSync(path.join(repo, "apps/web/electron/pack.mjs"), "utf8");
  assert.ok(pack.indexOf("assertHostTargets(") < pack.indexOf('"next", "build"'), "pack refuses before the Next build");
});

test("the marker hash changes with each input it covers", () => {
  const base = { pythonEntry: { version: "1", url: "u", sha256: "s" }, uvLock: Buffer.from("lock"), extras: ["mcp"], target: "linux-x64" };
  const h = markerHash(base);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(markerHash({ ...base }), h);
  assert.notEqual(markerHash({ ...base, pythonEntry: { ...base.pythonEntry, sha256: "t" } }), h);
  assert.notEqual(markerHash({ ...base, uvLock: Buffer.from("lock2") }), h);
  assert.notEqual(markerHash({ ...base, extras: ["mcp", "exa"] }), h);
  assert.notEqual(markerHash({ ...base, target: "win32-x64" }), h);
});

test("Linux site-packages are installed for a fixed glibc floor, not the staging host's glibc", () => {
  assert.equal(LINUX_GLIBC_FLOOR, "2.28");
  assert.deepEqual(pipInstallFlags("linux-x64"), [...PIP_INSTALL_FLAGS, "--python-platform", "x86_64-manylinux_2_28"]);
  assert.deepEqual(pipInstallFlags("linux-arm64"), [...PIP_INSTALL_FLAGS, "--python-platform", "aarch64-manylinux_2_28"]);
  for (const key of ["win32-x64", "darwin-arm64", "darwin-x64"]) assert.deepEqual(pipInstallFlags(key), PIP_INSTALL_FLAGS, key);
  // A stage installed without the pin (the host's glibc picked the wheels) is not reused.
  const base = { pythonEntry: { version: "1", url: "u", sha256: "s" }, uvLock: Buffer.from("lock"), extras: ["mcp"], target: "linux-x64" };
  assert.notEqual(markerHash(base), markerHash({ ...base, install: PIP_INSTALL_FLAGS }));
});

test("a change to the trim rules or the install flags restages instead of reusing the marker", () => {
  const base = { pythonEntry: { version: "1", url: "u", sha256: "s" }, uvLock: Buffer.from("lock"), extras: ["mcp"], target: "linux-x64" };
  const h = markerHash(base);
  assert.equal(markerHash({ ...base, trim: TRIM.map(String), install: pipInstallFlags("linux-x64") }), h);
  // The libpython rule (5afaf5eb) added without a format bump reused stages that still held libpython.
  const withoutLibpython = TRIM.filter((rx) => !rx.test("lib/libpython3.14.so")).map(String);
  assert.equal(withoutLibpython.length, TRIM.length - 1);
  assert.notEqual(markerHash({ ...base, trim: withoutLibpython }), h);
  assert.notEqual(markerHash({ ...base, install: PIP_INSTALL_FLAGS.filter((f) => f !== "--no-build") }), h);
  assert.ok(STAGE_FORMAT >= 2, "the libpython trim needs a format past 1");
});

test("each checkout gets its own scratch folder, so a clean in one worktree leaves another's run alone", () => {
  const home = path.join(os.tmpdir(), "home");
  const main = scratchRootFor("/src/timely", home);
  const worktree = scratchRootFor("/src/timely/.claude/worktrees/x", home);
  assert.equal(path.dirname(main), path.join(home, ".cache", "timely-agent-stage"));
  assert.equal(path.dirname(worktree), path.dirname(main));
  assert.notEqual(main, worktree);
  assert.equal(scratchRootFor("/src/timely/", home), main);
});

// ------------------------------------------------------------ interpreter trim

test("trimPlan drops headers, Tcl/Tk, idle, pip and the test package on a Linux tree, keeping the licence", (t) => {
  const py = path.join(tmp(t), "python");
  for (const rel of [
    "bin/python3.14", "bin/pip3", "bin/idle3.14", "bin/pydoc3.14", "bin/python3.14-config", "include/python3.14/Python.h",
    "share/man/man1/python3.1", "lib/libpython3.14.so.1.0", "lib/libpython3.14.so", "lib/libpython3.so", "lib/libtcl9.0.so", "lib/libtcl9tk9.0.so", "lib/tcl9.0/init.tcl",
    "lib/tk9.0/tk.tcl", "lib/itcl4.3.8/itcl.tcl", "lib/thread3.0.6/t.tcl", "lib/pkgconfig/python3.pc",
    "lib/python3.14/os.py", "lib/python3.14/LICENSE.txt", "lib/python3.14/idlelib/x.py", "lib/python3.14/tkinter/__init__.py",
    "lib/python3.14/turtledemo/x.py", "lib/python3.14/turtle.py", "lib/python3.14/ensurepip/__init__.py",
    "lib/python3.14/test/support.py", "lib/python3.14/site-packages/pip/__init__.py",
    "lib/python3.14/site-packages/pip-26.2.2.dist-info/METADATA", "lib/python3.14/site-packages/README.txt",
    "lib/python3.14/lib-dynload/_tkinter.cpython-314-x86_64-linux-gnu.so", "lib/python3.14/lib-dynload/_ssl.cpython-314-x86_64-linux-gnu.so",
    "lib/python3.14/lib-dynload/_dbm.cpython-314-x86_64-linux-gnu.so", "lib/python3.14/dbm/sqlite3.py",
    "lib/python3.14/unittest/__init__.py", "lib/python3.14/tomllib/__init__.py",
  ]) write(py, rel);
  const { drop, tests } = trimPlan(py);
  assert.deepEqual(tests, ["lib/python3.14/test"]);
  assert.deepEqual(new Set(drop), new Set([
    "bin/pip3", "bin/idle3.14", "bin/pydoc3.14", "bin/python3.14-config", "include", "share", "lib/libpython3.14.so.1.0", "lib/libpython3.14.so", "lib/libpython3.so", "lib/libtcl9.0.so",
    "lib/libtcl9tk9.0.so", "lib/tcl9.0", "lib/tk9.0", "lib/itcl4.3.8", "lib/thread3.0.6", "lib/pkgconfig",
    "lib/python3.14/idlelib", "lib/python3.14/tkinter", "lib/python3.14/turtledemo", "lib/python3.14/turtle.py",
    "lib/python3.14/ensurepip", "lib/python3.14/site-packages/pip", "lib/python3.14/site-packages/pip-26.2.2.dist-info",
    "lib/python3.14/lib-dynload/_tkinter.cpython-314-x86_64-linux-gnu.so",
    "lib/python3.14/lib-dynload/_dbm.cpython-314-x86_64-linux-gnu.so",
  ]));
  assert.equal(cpythonLicense(py), "lib/python3.14/LICENSE.txt");
  assert.equal(stdlibDir(py), path.join(py, "lib", "python3.14"));
});

test("trimPlan covers the Windows layout (Lib, DLLs, libs, Scripts, tcl, debug symbols)", (t) => {
  const py = path.join(tmp(t), "python");
  for (const rel of [
    "python.exe", "python314.dll", "LICENSE.txt", "include/Python.h", "libs/python314.lib", "Scripts/pip.exe", "tcl/tcl9.0/init.tcl",
    "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "DLLs/_ssl.pyd", "Lib/os.py", "Lib/tkinter/__init__.py",
    "Lib/idlelib/x.py", "Lib/test/x.py", "Lib/site-packages/pip/__init__.py",
    // 43 debug symbol files, 95 MB in the 3.14.9 archive; electron-builder's pdb exclusion skips extraResources
    "python.pdb", "python314.pdb", "pythonw.pdb", "DLLs/_ssl.pdb", "DLLs/_tkinter.pdb",
    "Lib/venv/scripts/nt/venvlauncher.exe", "Lib/venv/scripts/nt/venvlauncher.pdb", "Lib/venv/scripts/nt/venvwlauncher.pdb",
  ]) write(py, rel);
  const { drop, tests } = trimPlan(py);
  assert.deepEqual(tests, ["Lib/test"]);
  assert.deepEqual(new Set(drop), new Set([
    "include", "libs", "Scripts", "tcl", "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "Lib/tkinter", "Lib/idlelib",
    "Lib/site-packages/pip", "python.pdb", "python314.pdb", "pythonw.pdb", "DLLs/_ssl.pdb", "DLLs/_tkinter.pdb",
    "Lib/venv/scripts/nt/venvlauncher.pdb", "Lib/venv/scripts/nt/venvwlauncher.pdb",
  ]));
  assert.equal(cpythonLicense(py), "LICENSE.txt");
  assert.equal(stdlibDir(py), path.join(py, "Lib"));
  assert.equal(stagedPython("/a", "win32"), path.join("/a", "python", "python.exe"));
  assert.equal(stagedPython("/a", "linux"), path.join("/a", "python", "bin", "python3"));
});

test("a trimmed interpreter without its licence fails", (t) => {
  const py = path.join(tmp(t), "python");
  write(py, "lib/python3.14/os.py");
  assert.throws(() => cpythonLicense(py), /no CPython licence/);
});

test("importsStdlibTest finds a source that imports the stdlib test package", (t) => {
  const root = tmp(t);
  write(root, "a/clean.py", "import testing\nfrom tests import x\nimport contest\n# import test\n");
  assert.equal(importsStdlibTest([path.join(root, "a")]), "");
  write(root, "b/uses.py", "import os\nfrom test.support import os_helper\n");
  assert.match(importsStdlibTest([path.join(root, "a"), path.join(root, "b")]), /uses\.py$/);
  write(root, "c/plain.py", "  import test\n");
  assert.match(importsStdlibTest([path.join(root, "c")]), /plain\.py$/);
});

// ------------------------------------------------------------ skills

function skillsFixture(root) {
  const hermes = path.join(root, "hermes");
  const skill = (rel, name = path.basename(rel)) => write(hermes, `${rel}/SKILL.md`, `---\nname: ${name}\n---\nbody\n`);
  skill("skills/notes/on-skill");
  skill("skills/notes/off-skill");
  write(hermes, "skills/notes/off-skill/scripts/run.py", "print(1)\n");
  skill("skills/notes/denied-skill");
  skill("skills/notes/new-skill");
  skill("skills/notes/linked-skill");
  skill("skills/meta/hermes-agent");
  skill("skills/notes/replaced");
  write(hermes, "skills/notes/DESCRIPTION.md", "Notes skills\n");
  write(hermes, "skills/notes/on-skill/__pycache__/x.cpython-314.pyc", "pyc");
  skill("optional-skills/web/offered");
  skill("optional-skills/web/not-offered");
  skill("optional-skills/web/denied-optional");
  write(hermes, "optional-skills/web/DESCRIPTION.md", "Web\n");
  if (posix) symlinkSync("../on-skill/SKILL.md", path.join(hermes, "skills/notes/linked-skill/link.md"));
  write(hermes, "locales/en.yaml", "en: 1\n");
  write(hermes, "locales/de.yaml", "de: 1\n");
  write(hermes, "plugin-catalog/a.yaml");
  write(hermes, "HERMES_UPSTREAM.json", "{}");
  write(hermes, "pm/lock.json", "{}");
  write(hermes, "agent/core.py", "x = 1\n");
  write(hermes, "agent/__pycache__/core.cpython-314.pyc", "pyc");
  write(hermes, "agent/stale.pyc", "pyc");
  const reviewed = {
    skills: {
      "skills/notes/on-skill": { tree: "t1", default: "on" },
      "skills/notes/off-skill": { tree: "t2", default: "off" },
      "skills/notes/denied-skill": { tree: "t3", default: "off" },
      "skills/notes/linked-skill": "t4",
      "skills/meta/hermes-agent": { tree: "t5", default: "off" },
      "skills/notes/replaced": { tree: "t6" },
      "optional-skills/web/offered": { tree: "t7", offered: true },
      "optional-skills/web/not-offered": { tree: "t8", offered: false },
      "optional-skills/web/denied-optional": { tree: "t9", offered: false },
    },
  };
  const denied = { skills: { "skills/notes/denied-skill": {}, "optional-skills/web/denied-optional": {} } };
  return { hermes, reviewed, denied };
}

test("selectSkills ships the seed set and the offered optional skills only", (t) => {
  const { hermes, reviewed, denied } = skillsFixture(tmp(t));
  const s = selectSkills({ hermesDir: hermes, reviewed, denied, overrides: ["replaced"] });
  assert.deepEqual(s.seed, posix ? ["notes/off-skill", "notes/on-skill"] : ["notes/linked-skill", "notes/off-skill", "notes/on-skill"]);
  assert.deepEqual(s.optional, ["web/offered"]);
  assert.deepEqual(s.excluded.denied, ["skills/notes/denied-skill", "optional-skills/web/denied-optional"]);
  assert.deepEqual(s.excluded.unreviewed, ["skills/notes/new-skill"]);
  assert.deepEqual(s.excluded.essentialOff, ["skills/meta/hermes-agent"]);
  assert.deepEqual(s.excluded.overridden, ["skills/notes/replaced"]);
  assert.deepEqual(s.excluded.notOffered, ["optional-skills/web/not-offered"]);
  if (posix) assert.deepEqual(s.excluded.symlinked, ["skills/notes/linked-skill"]);
  // Without a deny list entry or a reviewed file nothing upstream ships.
  assert.deepEqual(selectSkills({ hermesDir: hermes, reviewed: null, denied }).seed, []);
});

test("the hermes copy filter keeps selected skills, category files, English and no bytecode", (t) => {
  const root = tmp(t);
  const { hermes, reviewed, denied } = skillsFixture(root);
  const s = selectSkills({ hermesDir: hermes, reviewed, denied, overrides: ["replaced"] });
  const out = path.join(root, "out");
  cpSync(hermes, out, { recursive: true, filter: hermesCopyFilter(hermes, s), verbatimSymlinks: true });
  assert.deepEqual(files(out), [
    "HERMES_UPSTREAM.json",
    "agent/core.py",
    "locales/en.yaml",
    "optional-skills/web/DESCRIPTION.md",
    "optional-skills/web/offered/SKILL.md",
    "plugin-catalog/a.yaml",
    "pm/lock.json",
    "skills/notes/DESCRIPTION.md",
    "skills/notes/off-skill/SKILL.md",
    "skills/notes/off-skill/scripts/run.py",
    "skills/notes/on-skill/SKILL.md",
  ]);
});

// ------------------------------------------------------------ tree checks

test("checkTree passes a clean tree and reports the longest path", (t) => {
  const root = tmp(t);
  write(root, "app/hermes/a.py", "x = 1\n");
  write(root, `app/${"b".repeat(MAX_PATH_CHARS - 4)}`);
  if (posix) {
    mkdirSync(path.join(root, "python/bin"), { recursive: true });
    write(root, "python/bin/python3.14");
    symlinkSync("python3.14", path.join(root, "python/bin/python3"));
  }
  const { problems, longest } = checkTree(root, { stagePath: root });
  assert.deepEqual(problems, []);
  assert.equal(longest.length, MAX_PATH_CHARS);
});

test("checkTree fails dotenv files, credentials and virtualenvs under app/, outside the pinned wheels", (t) => {
  // An untracked apps/agent/hermes/.env was copied into the stage and listed in MANIFEST.json.
  const root = tmp(t);
  write(root, "app/hermes/.env", "FAKE=1\n");
  write(root, "app/timely_agent/.env.local", "FAKE=1\n");
  write(root, "app/hermes/.op.env");
  write(root, "app/hermes/auth.json", "{}");
  write(root, "app/hermes/mcp-tokens/x.json", "{}");
  write(root, "app/hermes/.venv-probe/marker");
  write(root, "app/hermes/.env.example", "KEY=\n");
  write(root, "app/site-packages/somepkg/.env", "shipped by a hash-pinned wheel\n");
  write(root, "app/hermes/environment.py", "x = 1\n");
  const { problems } = checkTree(root, { stagePath: root });
  const named = problems.map((p) => p.split(": ").pop()).sort();
  assert.deepEqual(named, [
    "app/hermes/.env",
    "app/hermes/.op.env",
    "app/hermes/.venv-probe",
    "app/hermes/auth.json",
    "app/hermes/mcp-tokens",
    "app/timely_agent/.env.local",
  ]);
  for (const p of problems) assert.match(p, /never ships/);
});

test("trackedOnly copies only what git tracks and names what it left out", (t) => {
  const repoRoot = tmp(t);
  const src = path.join(repoRoot, "apps/agent/hermes");
  write(src, "run_agent.py");
  write(src, "tools/a.py");
  write(src, ".env", "FAKE=1\n");
  write(src, ".venv-probe/marker");
  write(src, "tools/__pycache__/a.cpython-314.pyc");
  write(src, "tools/scratch.py");
  const tracked = new Set(["apps/agent/hermes/run_agent.py", "apps/agent/hermes/tools/a.py"]);
  const skipped = [];
  const out = path.join(repoRoot, "out");
  cpSync(src, out, { recursive: true, filter: trackedOnly(plainCopyFilter(src), { repoRoot, tracked, skipped }) });
  assert.deepEqual(files(out).sort(), ["run_agent.py", "tools/a.py"]);
  // caches are the inner filter's business, not "left out"
  assert.deepEqual(skipped.sort(), ["apps/agent/hermes/.env", "apps/agent/hermes/.venv-probe", "apps/agent/hermes/tools/scratch.py"]);
  const inner = plainCopyFilter(src);
  assert.equal(trackedOnly(inner, { repoRoot, tracked: null }), inner, "no git checkout (the Docker stage): the plain filter");
});

test("an untracked-only skills folder stages as an empty folder, and an untracked override hides no upstream skill", (t) => {
  const repoRoot = tmp(t);
  const skills = path.join(repoRoot, "apps/agent/skills");
  write(skills, "probe/SKILL.md", "---\n");
  write(skills, "overrides/replaced/SKILL.md", "---\n");
  write(skills, "overrides/draft/SKILL.md", "---\n");
  const out = path.join(repoRoot, "out", "skills");
  copyInto(skills, out, { recursive: true, filter: trackedOnly(plainCopyFilter(skills), { repoRoot, tracked: new Set(["apps/agent/hermes/a.py"]) }) });
  assert.deepEqual(readdirSync(out), [], "nothing tracked: an empty folder, which makeReadOnly can walk");
  makeReadOnly(out);
  makeWritable(out);
  copyInto(path.join(repoRoot, "missing"), path.join(repoRoot, "out", "none"), { recursive: true });
  assert.ok(existsSync(path.join(repoRoot, "out", "none")));

  const overrides = path.join(skills, "overrides");
  const tracked = new Set(["apps/agent/skills/overrides/replaced/SKILL.md"]);
  assert.deepEqual(trackedSkillNames(overrides, { repoRoot, tracked }), ["replaced"]);
  assert.deepEqual(trackedSkillNames(overrides, { repoRoot, tracked: null }), ["draft", "replaced"], "no checkout: every override");
});

test("gitTracked lists tracked files under the folders asked for, and is null outside a checkout", { skip: spawnSync("git", ["--version"]).status !== 0 && "no git" }, (t) => {
  const root = tmp(t);
  assert.equal(gitTracked(root, ["apps/agent"]), null);
  const git = (...args) => assert.equal(spawnSync("git", args, { cwd: root, encoding: "utf8" }).status, 0, args.join(" "));
  git("init", "-q");
  write(root, "apps/agent/hermes/a.py");
  write(root, "apps/agent/hermes/sp ace/b.md");
  write(root, "apps/agent/.gitignore", ".env\n");
  write(root, "apps/agent/hermes/.env", "FAKE=1\n");
  write(root, "other/c.txt");
  git("add", "-A");
  write(root, "apps/agent/hermes/untracked.py");
  assert.deepEqual([...gitTracked(root, ["apps/agent/hermes"])].sort(), ["apps/agent/hermes/a.py", "apps/agent/hermes/sp ace/b.md"]);
});

test("checkTree also fails keys, credential files and key folders a developer's tree may hold under app/", (t) => {
  const root = tmp(t);
  for (const rel of [
    "app/timely_agent/credentials.json",
    "app/hermes/.ssh/id_ed25519",
    "app/hermes/id_rsa",
    "app/hermes/server.pem",
    "app/hermes/tls.key",
    "app/hermes/.netrc",
    "app/hermes/.pypirc",
    "app/hermes/.npmrc",
    "app/hermes/.aws/config",
    "app/hermes/store.p12",
  ]) {
    write(root, rel);
  }
  write(root, "app/hermes/keys.py", "x = 1\n");
  write(root, "app/hermes/skills/x/credentials.md", "how to set credentials\n");
  write(root, "app/site-packages/certifi/cacert.pem", "shipped by a hash-pinned wheel\n");
  const named = checkTree(root, { stagePath: root }).problems.map((p) => p.split(": ").pop()).sort();
  assert.deepEqual(named, [
    "app/hermes/.aws",
    "app/hermes/.netrc",
    "app/hermes/.npmrc",
    "app/hermes/.pypirc",
    "app/hermes/.ssh",
    "app/hermes/id_rsa",
    "app/hermes/server.pem",
    "app/hermes/store.p12",
    "app/hermes/tls.key",
    "app/timely_agent/credentials.json",
  ]);
});

test("without .git the stage copies only the files make agent-tracked-list listed, and refuses to guess when there is no list", (t) => {
  // The Docker build context has no .git: before this, every untracked file under apps/agent
  // (a credentials.json, an SSH key, Hermes' .hermes-update.lock) went into /app/agent.
  const root = tmp(t);
  write(root, "apps/agent/timely_agent/seed.py", "x");
  write(root, "apps/agent/timely_agent/credentials.json", "{}");
  assert.throws(() => trackedSources(root), /and no apps\/agent\/\.git-tracked: .*make agent-tracked-list/s);
  write(root, "apps/agent/.git-tracked", "");
  assert.throws(() => trackedSources(root), /lists no file/);
  write(root, "apps/agent/.git-tracked", "apps/agent/timely_agent/seed.py\0");
  const { tracked, from } = trackedSources(root);
  assert.equal(from, "apps/agent/.git-tracked");
  const out = path.join(root, "out");
  const skipped = [];
  cpSync(path.join(root, "apps/agent/timely_agent"), out, {
    recursive: true,
    filter: trackedOnly(plainCopyFilter(path.join(root, "apps/agent/timely_agent")), { repoRoot: root, tracked, skipped }),
  });
  assert.deepEqual(files(out), ["seed.py"]);
  assert.deepEqual(skipped, ["apps/agent/timely_agent/credentials.json"]);
  const make = readFileSync(path.join(repo, "Makefile"), "utf8");
  assert.match(make, /^agent-tracked-list:.*\n\t@git ls-files -z --cached -- apps\/agent > apps\/agent\/\.git-tracked$/m);
  assert.match(make, /^docker-api: agent-tracked-list /m);
  assert.match(make, /^docker-agent-smoke: agent-tracked-list /m);
  assert.doesNotMatch(readFileSync(path.join(repo, ".dockerignore"), "utf8"), /git-tracked/);
});

test("without .git a list older than the context fails the stage: a file it does not name, or one it names that is gone", (t) => {
  // A list written before a Hermes sync added tools/approval_smart.py staged a runtime without it,
  // and every check passed; the worker then failed on `from tools.approval_smart import ...`.
  const root = tmp(t);
  write(root, "apps/agent/hermes/tools/approval.py", "from tools.approval_smart import x");
  write(root, "apps/agent/hermes/tools/approval_smart.py", "x = 1");
  write(root, "apps/agent/hermes/.hermes-update.lock", "");
  write(root, "apps/agent/hermes/tools/__pycache__/approval.cpython-314.pyc", "");
  write(root, "apps/agent/timely_agent/new_pkg/__init__.py", "");
  write(root, "apps/agent/timely_agent/seed.py", "");
  write(root, "apps/agent/.git-tracked", ["apps/agent/hermes/tools/approval.py", "apps/agent/timely_agent/seed.py", "apps/agent/timely_agent/gone.py", ""].join("\0"));
  const { tracked } = trackedSources(root);
  const skipped = [];
  for (const rel of ["hermes", "timely_agent"]) {
    const src = path.join(root, "apps/agent", rel);
    cpSync(src, path.join(root, "out", rel), { recursive: true, filter: trackedOnly(() => true, { repoRoot: root, tracked, skipped }) });
  }
  assert.ok(!existsSync(path.join(root, "out/hermes/tools/approval_smart.py")));
  assert.deepEqual(staleTrackedList({ repoRoot: root, tracked, skipped }), {
    unlisted: ["apps/agent/hermes/tools/approval_smart.py", "apps/agent/timely_agent/new_pkg/__init__.py"],
    missing: ["apps/agent/timely_agent/gone.py"],
  });
  // A list that matches the context (an update lock and bytecode aside) passes.
  rmSync(path.join(root, "apps/agent/timely_agent/new_pkg"), { recursive: true });
  write(root, "apps/agent/timely_agent/gone.py", "");
  const fresh = new Set([...tracked, "apps/agent/hermes/tools/approval_smart.py"]);
  assert.deepEqual(staleTrackedList({ repoRoot: root, tracked: fresh, skipped: ["apps/agent/hermes/.hermes-update.lock", "apps/agent/hermes/tools/__pycache__"] }), { unlisted: [], missing: [] });
  // The stage calls it whenever it has no git checkout.
  const stage = readFileSync(path.join(repo, "apps/web/electron/stage-agent.mjs"), "utf8");
  assert.match(stage, /if \(trackedFrom !== "git"\) \{\n\s+\/\/[^\n]*\n\s+const \{ unlisted, missing \} = staleTrackedList\(/);
});

test("checkTree fails a path of 151 characters", (t) => {
  const root = tmp(t);
  write(root, `app/${"c".repeat(MAX_PATH_CHARS - 3)}`);
  const { problems } = checkTree(root, { stagePath: root });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /longer than 150 characters \(151\)/);
});

test("dropLongBytecode drops only bytecode over the limit, so the tree check passes and the source stays", (t) => {
  const root = tmp(t);
  const dir = "app/site-packages/pkg";
  const long = "m".repeat(MAX_PATH_CHARS - `${dir}/__pycache__/.cpython-314.pyc`.length + 1);
  write(root, `${dir}/${long}.py`, "x = 1\n");
  write(root, `${dir}/__pycache__/${long}.cpython-314.pyc`);
  write(root, `${dir}/short.py`, "y = 2\n");
  write(root, `${dir}/__pycache__/short.cpython-314.pyc`);
  assert.equal(checkTree(root, { stagePath: root }).problems.length, 1);

  assert.deepEqual(dropLongBytecode(root, MAX_PATH_CHARS), [`${dir}/__pycache__/${long}.cpython-314.pyc`]);
  assert.deepEqual(checkTree(root, { stagePath: root }).problems, []);
  assert.deepEqual(files(root).sort(), [`${dir}/${long}.py`, `${dir}/__pycache__/short.cpython-314.pyc`, `${dir}/short.py`].sort());

  // An emptied __pycache__ goes too; a long source file is never dropped.
  const other = tmp(t);
  write(other, `${dir}/__pycache__/${long}.cpython-314.pyc`);
  write(other, `app/${"s".repeat(MAX_PATH_CHARS)}.py`);
  assert.equal(dropLongBytecode(other, MAX_PATH_CHARS).length, 1);
  assert.equal(existsSync(path.join(other, dir, "__pycache__")), false);
  assert.equal(checkTree(other, { stagePath: other }).problems.length, 1);
});

test("checkTree fails absolute symlinks and relative ones that leave the root", { skip: !posix && "symlinks need privileges on Windows" }, (t) => {
  const root = tmp(t);
  write(root, "app/real.txt");
  symlinkSync(path.join(root, "app/real.txt"), path.join(root, "app/abs-link"));
  symlinkSync("../../outside", path.join(root, "app/escape"));
  symlinkSync("real.txt", path.join(root, "app/fine"));
  const { problems } = checkTree(root, { stagePath: path.join(root, "nowhere") });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /absolute target: app\/abs-link/);
  assert.match(problems.join("\n"), /outside the root: app\/escape -> \.\.\/\.\.\/outside/);
});

test("checkTree fails a file that holds the absolute stage path, in either slash form", (t) => {
  const root = tmp(t);
  const stagePath = "C:\\build\\apps\\web\\.electron-agent\\win-x64";
  write(root, "app/site-packages/pkg/script.py", "#!/home/runner/work/x/python\n");
  write(root, "app/site-packages/RECORD", `path=${stagePath}\\app\\x\n`);
  write(root, "app/b.pyc", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("C:/build/apps/web/.electron-agent/win-x64/app/b.py")]));
  const { problems } = checkTree(root, { stagePath });
  assert.deepEqual(problems.sort(), [
    `holds the absolute stage path ${stagePath}: app/b.pyc`,
    `holds the absolute stage path ${stagePath}: app/site-packages/RECORD`,
  ]);
});

test("checkTree fails playwright, pyppeteer or a Chromium binary", (t) => {
  const root = tmp(t);
  write(root, "app/site-packages/playwright/__init__.py");
  write(root, "app/site-packages/pyppeteer-2.0.0.dist-info/METADATA");
  write(root, "app/site-packages/browser_harness/__init__.py");
  write(root, "app/hermes/tools/browser_chromium.py");
  write(root, "app/site-packages/x/.local-browsers/chrome-linux/chrome");
  const { problems } = checkTree(root, { stagePath: path.join(root, "nowhere") });
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /browser package in site-packages: app\/site-packages\/playwright/);
  assert.match(problems.join("\n"), /browser package in site-packages: app\/site-packages\/pyppeteer-2\.0\.0\.dist-info/);
  assert.match(problems.join("\n"), /browser binary: .*chrome-linux\/chrome/);
});

// ------------------------------------------------------------ licences

test("parseMetadata reads licence fields and folds continuation lines", () => {
  const m = parseMetadata(
    "Metadata-Version: 2.4\nName: demo\nVersion: 1.0\nLicense: BSD 3-Clause\n        Copyright x\nClassifier: License :: OSI Approved :: MIT License\n" +
      "Classifier: Topic :: X\nLicense-File: LICENSE\nLicense-File: NOTICE\n\nLicense: not a header\n",
  );
  assert.equal(m.name, "demo");
  assert.equal(m.version, "1.0");
  assert.equal(m.license, "BSD 3-Clause\nCopyright x");
  assert.deepEqual(m.classifiers, ["License :: OSI Approved :: MIT License"]);
  assert.deepEqual(m.licenseFiles, ["LICENSE", "NOTICE"]);
});

test("collectLicenses takes licence files, falls back to a recorded text, and names distributions left with only a licence name", (t) => {
  const site = tmp(t);
  write(site, "files_only-1.0.dist-info/METADATA", "Name: files-only\nVersion: 1.0\n\n");
  write(site, "files_only-1.0.dist-info/licenses/LICENSE.txt", "MIT text\n");
  write(site, "files_only-1.0.dist-info/licenses/vendor/NOTICE", "notice text\n");
  write(site, "expr-2.0.dist-info/METADATA", "Name: expr\nVersion: 2.0\nLicense-Expression: Apache-2.0\n\n");
  write(site, "old-3.0.dist-info/METADATA", "Name: old\nVersion: 3.0\nLicense-File: COPYING\n\n");
  write(site, "old-3.0.dist-info/COPYING", "GPL? no, BSD\n");
  write(site, "classified-1.dist-info/METADATA", "Name: classified\nVersion: 1\nClassifier: License :: OSI Approved :: MIT License\n\n");
  write(site, "Fetch_Use-0.4.0.dist-info/METADATA", "Name: Fetch_Use\nVersion: 0.4.0\nLicense: MIT\n\n");
  write(site, "bare-0.1.dist-info/METADATA", "Name: bare\nVersion: 0.1\n\n");
  write(site, "bare/__init__.py");
  // A licence name is not the copyright notice MIT and BSD require.
  assert.deepEqual(collectLicenses(site).missing, ["Fetch_Use", "bare", "classified", "expr"]);
  const licensesDir = tmp(t);
  write(licensesDir, "dists/fetch-use.txt", "MIT License\n\nCopyright (c) Browser-Use\n");
  write(licensesDir, "dists/expr.txt", "Apache text\n");
  const overrides = { "fetch-use": { file: "dists/fetch-use.txt" }, expr: { file: "dists/expr.txt" }, "files-only": { file: "dists/never.txt" } };
  const { dists, missing } = collectLicenses(site, { licensesDir, overrides });
  assert.deepEqual(missing, ["bare", "classified"]);
  const by = Object.fromEntries(dists.map((d) => [d.name, d]));
  assert.deepEqual(by["files-only"].files.map((f) => f.rel).sort(), ["licenses/LICENSE.txt", "licenses/vendor/NOTICE"], "a shipped licence file wins");
  assert.deepEqual(by.Fetch_Use.files, [{ rel: "apps/agent/packaging/licenses/dists/fetch-use.txt", text: "MIT License\n\nCopyright (c) Browser-Use\n" }]);
  assert.equal(by.expr.license, "Apache-2.0");
  assert.deepEqual(by.old.files.map((f) => f.rel), ["COPYING"]);
  assert.equal(by.classified.license, "License :: OSI Approved :: MIT License");
  const text = thirdPartyLicenses({ cpython: "PSF", hermes: "MIT Nous", notice: "Timely NOTICE", dists });
  for (const needle of ["PSF", "MIT Nous", "Timely NOTICE", "files-only 1.0", "MIT text", "notice text", "expr 2.0 (app/site-packages/expr-2.0.dist-info): Apache-2.0", "BSD", "Copyright (c) Browser-Use"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(text.indexOf("PSF") < text.indexOf("MIT Nous") && text.indexOf("MIT Nous") < text.indexOf("Timely NOTICE"));
});

const BUNDLED = `License for "pillow-heif" binary wheels: GPLv2, due to base library licenses.

Name: x265
License: GPLv2
Files: libx265.[dylib|so|dll]
  Source code: https://github.com/Multicorewareinc/x265/tree/4.3
`;

test("a distribution shipping GPL or LGPL binaries needs a reviewed entry with its version, and brings the full texts and sources", (t) => {
  const site = tmp(t);
  write(site, "pillow_heif-1.8.1.dist-info/METADATA", "Name: pillow_heif\nVersion: 1.8.1\nLicense-Expression: BSD-3-Clause\n\n");
  write(site, "pillow_heif-1.8.1.dist-info/licenses/LICENSES_bundled.txt", BUNDLED);
  write(site, "pillow_heif.libs/libx265-4883ecb5.so.217", "elf");
  write(site, "pillow-13.0.0.dist-info/METADATA", "Name: pillow\nVersion: 13.0.0\nLicense-Expression: MIT-CMU\n\n");
  write(site, "pillow-13.0.0.dist-info/licenses/LICENSE", "FreeType: FTL or the GNU General Public License version 2 (GPLv2.TXT)\n");
  write(site, "lgpl_lib-1.dist-info/METADATA", "Name: lgpl-lib\nVersion: 1\nLicense-Expression: LGPL-3.0-or-later\n\n");
  write(site, "lgpl_lib-1.dist-info/LICENSE", "lgpl\n");
  const { dists } = collectLicenses(site);
  assert.deepEqual(dists.filter(declaresCopyleft).map((d) => d.name), ["lgpl-lib", "pillow_heif"]);
  const entry = {
    version: "1.8.1",
    why: "HEIC support",
    texts: ["GPL-2.0", "LGPL-3.0"],
    libraries: [{ name: "x265 4.3", license: "GPL-2.0-or-later", files: "libx265", source: "https://github.com/Multicorewareinc/x265/tree/4.3" }],
  };
  let review = copyleftReview(dists, {});
  assert.equal(review.problems.length, 2);
  assert.match(review.problems.join("\n"), /pillow_heif 1\.8\.1 ships GPL or LGPL code: review it/);
  review = copyleftReview(dists, { "pillow-heif": { ...entry, version: "1.8.0" }, "lgpl-lib": { ...entry, version: "1", libraries: [] } });
  assert.deepEqual(review.problems, [
    "pillow_heif is 1.8.1 but apps/agent/packaging/licenses/copyleft.json reviewed 1.8.0: check its bundled libraries, versions and source links, then update the entry",
  ]);
  review = copyleftReview(dists, { "pillow-heif": entry });
  assert.equal(review.listed.length, 1);
  const gnuTexts = { "GPL-2.0": "GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991\n", "LGPL-3.0": "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n" };
  const text = thirdPartyLicenses({ cpython: "PSF", hermes: "MIT", notice: "N", dists, copyleft: review.listed, gnuTexts });
  for (const needle of ["Version 2, June 1991", "Version 3, 29 June 2007", "x265 4.3: GPL-2.0-or-later", "complete source: https://github.com/Multicorewareinc/x265/tree/4.3"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.throws(() => thirdPartyLicenses({ cpython: "", hermes: "", notice: "", dists, copyleft: review.listed, gnuTexts: {} }), /no licence text for GPL-2\.0, LGPL-3\.0/);
});

test("the committed licence texts cover every distribution of the dev runtime and its reviewed copyleft entries", { skip: !existsSync(path.join(repo, "apps/agent/.venv/lib/python3.14/site-packages")) && "make agent-install first" }, () => {
  const licensesDir = path.join(repo, "apps/agent/packaging/licenses");
  const overrides = JSON.parse(readFileSync(path.join(licensesDir, "dists.json"), "utf8"));
  for (const [name, o] of Object.entries(overrides)) if (!name.startsWith("_")) assert.ok(existsSync(path.join(licensesDir, o.file)), o.file);
  const { dists, missing } = collectLicenses(path.join(repo, "apps/agent/.venv/lib/python3.14/site-packages"), { licensesDir, overrides });
  assert.deepEqual(missing, []);
  const policy = JSON.parse(readFileSync(path.join(licensesDir, "copyleft.json"), "utf8"));
  const review = copyleftReview(dists, policy);
  assert.deepEqual(review.problems, []);
  assert.deepEqual(review.listed.map(({ dist }) => dist.name), ["pillow_heif"]);
  for (const id of policy["pillow-heif"].texts) assert.ok(existsSync(path.join(licensesDir, "gnu", `${id}.txt`)), id);
});

// ------------------------------------------------------------ the interpreter's built-in libraries

test("downloadFile retries a network error, a cut-off body and a 5xx, and names the URL and the cause when it gives up", async (t) => {
  const dir = tmp(t);
  const dest = path.join(dir, "a", "python.tar.gz");
  const body = (text) => new Response(text).body;
  const cutOff = () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("par"));
        c.error(new Error("terminated"));
      },
    });
  const reset = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
  const plan = [
    () => {
      throw reset;
    },
    () => ({ ok: true, status: 200, body: cutOff() }),
    () => ({ ok: false, status: 503, statusText: "Service Unavailable", body: body("") }),
    () => ({ ok: true, status: 200, body: body("complete") }),
  ];
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async (url) => {
    assert.equal(url, "https://example.test/python.tar.gz");
    return plan[calls++]();
  };
  await downloadFile("https://example.test/python.tar.gz", dest, { attempts: 4, delayMs: 10, fetchImpl, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(readFileSync(dest, "utf8"), "complete");
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [10, 20, 40]);
  assert.ok(!existsSync(`${dest}.part`));

  calls = 0;
  plan.length = 0;
  plan.push(() => {
    throw reset;
  });
  plan.push(() => {
    throw reset;
  });
  await assert.rejects(
    downloadFile("https://example.test/python.tar.gz", path.join(dir, "b"), { attempts: 2, delayMs: 1, fetchImpl, sleep: async () => {} }),
    /GET https:\/\/example\.test\/python\.tar\.gz failed after 2 attempt\(s\): fetch failed: read ECONNRESET.*; fetch failed/,
  );
  // A 404 is not retried.
  calls = 0;
  plan.length = 0;
  plan.push(() => ({ ok: false, status: 404, statusText: "Not Found", body: body("") }));
  await assert.rejects(
    downloadFile("https://example.test/python.tar.gz", path.join(dir, "c"), { attempts: 3, fetchImpl, sleep: async () => assert.fail("no retry on 404") }),
    /after 1 attempt\(s\): HTTP 404 Not Found/,
  );
  assert.equal(calls, 1);
});

// ------------------------------------------------------------ statically linked code

const CRATES_IO = "index.crates.io-1949cf8c6b5b557f";

test("rustCrates reads crates.io, standard-library and git crate paths in either slash form from a binary", () => {
  const bin = Buffer.concat([
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]),
    Buffer.from(`/root/.cargo/registry/src/${CRATES_IO}/ring-0.17.14/src/aead.rs\0`),
    Buffer.from(`/home/runner/.cargo/registry/src/${CRATES_IO}/aws-lc-rs-1.18.1/src/lib.rs\0`),
    Buffer.from(`C:\\Users\\runner\\.cargo\\registry\\src\\${CRATES_IO}\\windows-sys-0.59.0\\src\\lib.rs\0`),
    Buffer.from(`/cargo/registry/src/github.com-1ecc6299db9ec823/base64-0.13.1/src/x.rs\0`),
    Buffer.from(`/rust/deps/hashbrown-0.16.1/src/raw.rs\0`),
    Buffer.from(`/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/fmt.rs\0`),
    Buffer.from(`/root/.cargo/git/checkouts/tiny-thing-0123456789abcdef/abc/src/lib.rs\0`),
    Buffer.from(`/root/.cargo/registry/src/${CRATES_IO}/ring-0.17.14/src/again.rs\0`),
    Buffer.from(`/root/.cargo/registry/src/${CRATES_IO}/semver-pre-1.0.0-rc.1/src/x.rs\0`),
  ]);
  const got = rustCrates(bin);
  assert.deepEqual(got.crates, ["aws-lc-rs@1.18.1", "base64@0.13.1", "hashbrown@0.16.1", "ring@0.17.14", "semver-pre@1.0.0-rc.1", "windows-sys@0.59.0"]);
  assert.deepEqual(got.rustc, ["48a229ceaefd4985c50990b14116b6d856af0985"]);
  assert.deepEqual(got.git, ["tiny-thing"]);
  assert.deepEqual(rustCrates(Buffer.from("plain C code, ffi_prep_cif")), { crates: [], rustc: [], git: [] });
});

/** A site-packages fixture: dists {dir: {name, version, files: {rel: content}}}. */
function fakeSite(root, dists) {
  for (const [dir, d] of Object.entries(dists)) {
    write(root, `${dir}/METADATA`, `Metadata-Version: 2.4\nName: ${d.name}\nVersion: ${d.version}\n\n`);
    const rels = Object.keys(d.files);
    write(root, `${dir}/RECORD`, [...rels.map((r) => `${r.includes(",") ? `"${r}"` : r},sha256=x,1`), `${dir}/RECORD,,`].join("\n") + "\n");
    for (const [rel, content] of Object.entries(d.files)) write(root, rel, content);
  }
}

test("nativeBinaries groups each extension module's crates under the distribution whose RECORD lists it", (t) => {
  const site = tmp(t);
  fakeSite(site, {
    "jiter-0.17.0.dist-info": {
      name: "jiter",
      version: "0.17.0",
      files: { "jiter/__init__.py": "", "jiter/jiter.cpython-314-x86_64-linux-gnu.so": `x/${CRATES_IO}/serde-1.0.1/src/a.rs\0/rust/deps/gimli-0.32.3/x\0` },
    },
    "Pure_Thing-1.0.dist-info": { name: "Pure_Thing", version: "1.0", files: { "pure/__init__.py": "" } },
    "cffi-2.1.1.dist-info": { name: "cffi", version: "2.1.1", files: { "_cffi_backend.cpython-314-x86_64-linux-gnu.so": "ffi_prep_cif" } },
  });
  write(site, "stray/_x.pyd", `${CRATES_IO}/rand-0.8.5/`);
  const { dists, unowned } = nativeBinaries(site);
  assert.deepEqual(
    dists.map((d) => [d.key, d.binaries.map((b) => [b.rel, b.crates])]),
    [
      ["cffi-2.1.1", [["_cffi_backend.cpython-314-x86_64-linux-gnu.so", []]]],
      ["jiter-0.17.0", [["jiter/jiter.cpython-314-x86_64-linux-gnu.so", ["gimli@0.32.3", "serde@1.0.1"]]]],
    ],
  );
  assert.deepEqual(unowned, ["stray/_x.pyd"]);
});

function fakeStatic(dir, records, texts = {}) {
  for (const [id, text] of Object.entries(texts)) write(dir, `texts/${id}.txt`, text);
  for (const r of records) write(dir, `${r.key}.json`, JSON.stringify(r.record));
}

test("staticLicenses needs a record for each distribution linking Rust code or listed in components.json, naming every crate it links", (t) => {
  const dir = tmp(t);
  const bin = (rel, crates, rustc = []) => ({ rel, crates, rustc, git: [] });
  const found = [
    { name: "jiter", version: "0.17.0", key: "jiter-0.17.0", dir: "jiter-0.17.0.dist-info", binaries: [bin("jiter/j.so", ["serde@1.0.1", "ryu@1.0.0"], ["c0"])] },
    { name: "nemo_relay", version: "0.11.0", key: "nemo-relay-0.11.0", dir: "nemo_relay-0.11.0.dist-info", binaries: [bin("nemo_relay/_native.so", ["ring@0.17.14"])] },
    { name: "cffi", version: "2.1.1", key: "cffi-2.1.1", dir: "cffi-2.1.1.dist-info", binaries: [bin("_cffi_backend.so", [])] },
    { name: "markupsafe", version: "3.0.4", key: "markupsafe-3.0.4", dir: "markupsafe-3.0.4.dist-info", binaries: [bin("markupsafe/_speedups.so", [])] },
    { name: "watchfiles", version: "1.3.0", key: "watchfiles-1.3.0", dir: "w.dist-info", binaries: [{ rel: "w/_w.so", crates: [], rustc: [], git: ["notify"] }] },
  ];
  fakeStatic(
    dir,
    [
      {
        key: "jiter-0.17.0",
        record: {
          dist: "jiter",
          version: "0.17.0",
          rustStd: null,
          crates: [
            { name: "serde", version: "1.0.1", license: "MIT OR Apache-2.0", files: [{ rel: "LICENSE-MIT", text: "t1" }] },
            { name: "extra", version: "2.0.0", license: "MIT", files: [{ rel: "LICENSE", text: "t1" }] },
          ],
          components: [],
        },
      },
      { key: "watchfiles-1.3.0", record: { dist: "watchfiles", version: "1.3.0", rustStd: null, crates: [], components: [] } },
    ],
    { t1: "MIT text\n" },
  );
  const { records, problems } = staticLicenses(found, dir, { components: { cffi: [{ name: "libffi" }] } });
  const all = problems.join("\n");
  assert.match(all, /jiter 0\.17\.0 links crates static\/jiter-0\.17\.0\.json does not record \(1\): ryu@1\.0\.0; run make agent-static-licenses/);
  assert.match(all, /jiter 0\.17\.0 links the Rust standard library, which static\/jiter-0\.17\.0\.json does not record/);
  assert.match(all, /nemo_relay 0\.11\.0 links 1 Rust crate\(s\) into nemo_relay\/_native\.so, but apps\/agent\/packaging\/licenses\/static\/nemo-relay-0\.11\.0\.json does not record/);
  assert.match(all, /cffi 2\.1\.1 links libffi in \(static\/components\.json\), but static\/cffi-2\.1\.1\.json does not exist/);
  assert.match(all, /watchfiles 1\.3\.0: w\/_w\.so links notify from a git checkout/);
  assert.doesNotMatch(all, /markupsafe/, "plain C extensions of the project's own code need no record");
  assert.equal(problems.length, 5);
  const jiter = records.find((r) => r.dist.name === "jiter").record;
  assert.deepEqual(jiter.crates.map((c) => [c.name, c.files[0].body]), [["serde", "MIT text\n"], ["extra", "MIT text\n"]]);
});

test("THIRD_PARTY_LICENSES lists each distribution's linked crates and C libraries, with every text once", () => {
  const files = (id, rel) => [{ rel, text: id, body: `text ${id}\n` }];
  const statics = [
    {
      dist: { name: "cryptography", version: "50.0.2", dir: "cryptography-50.0.2.dist-info" },
      record: {
        rustStd: { rustc: ["48a229ceaefd4985c50990b14116b6d856af0985"], license: "MIT OR Apache-2.0", files: files("std1", "LICENSE-MIT") },
        components: [{ name: "OpenSSL", version: "4.0.3", license: "Apache-2.0", files: files("ossl", "LICENSE.txt") }],
        crates: [{ name: "pem", version: "3.0.0", license: "MIT", files: files("mit1", "LICENSE.md") }],
      },
    },
    {
      dist: { name: "jiter", version: "0.17.0", dir: "jiter-0.17.0.dist-info" },
      record: { rustStd: null, components: [], crates: [{ name: "pem", version: "3.0.0", license: "MIT", files: files("mit1", "LICENSE.md") }] },
    },
  ];
  const out = thirdPartyLicenses({ cpython: "PSF", hermes: "MIT", notice: "N", dists: [], statics });
  assert.match(out, /Code linked statically into the native modules of these distributions/);
  assert.match(out, /cryptography 50\.0\.2 \(app\/site-packages\/cryptography-50\.0\.2\.dist-info\):\n {2}Rust standard library \(rustc 48a229ceaefd\): MIT OR Apache-2\.0 \[std1\]\n {2}OpenSSL 4\.0\.3 \(C library\): Apache-2\.0 \[ossl\]\n {2}pem 3\.0\.0: MIT \[mit1\]/);
  assert.match(out, /jiter 0\.17\.0 \(app\/site-packages\/jiter-0\.17\.0\.dist-info\):\n {2}pem 3\.0\.0: MIT \[mit1\]/);
  assert.equal(out.split("--- [mit1] pem 3.0.0 LICENSE.md\ntext mit1").length, 2, "each text once");
  assert.match(out, /--- \[ossl\] OpenSSL 4\.0\.3 LICENSE\.txt\ntext ossl/);
});

test("the Windows runtime's THIRD_PARTY_LICENSES names the programs pywinpty bundles: rprichard's winpty and Windows Terminal's OpenConsole and ConPTY", () => {
  const dir = path.join(repo, "apps/agent/packaging/licenses/static");
  const components = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(dir, "components.json"), "utf8"))).filter(([k]) => !k.startsWith("_")));
  const record = readdirSync(dir).find((f) => /^pywinpty-.*\.json$/.test(f));
  const version = JSON.parse(readFileSync(path.join(dir, record), "utf8")).version;
  const dist = { name: "pywinpty", version, dir: `pywinpty-${version}.dist-info`, key: `pywinpty-${version}`, binaries: [{ rel: "winpty/winpty.dll", crates: [], rustc: [], git: [] }] };
  const { records, problems } = staticLicenses([dist], dir, { components });
  assert.deepEqual(problems, []);
  const names = records[0].record.components.map((c) => c.name);
  assert.deepEqual(names, ["winpty", "Windows Terminal OpenConsole and ConPTY"]);
  const text = thirdPartyLicenses({ cpython: "PSF", hermes: "MIT", notice: "N", dists: [], statics: records });
  assert.match(text, /winpty 0\.4\.3 \(bundled DLL and program\): MIT/);
  assert.match(text, /Windows Terminal OpenConsole and ConPTY 1\.25\.\S+ .*\(bundled DLL and program\): MIT/);
  for (const notice of ["Copyright (c) 2011-2016 Ryan Prichard", "Copyright (c) Microsoft Corporation"]) assert.ok(text.includes(notice), notice);
});

test("the pywin32 parts the worker never loads leave site-packages: Pythonwin (Scintilla, MFC), isapi, the service and perfmon hosts", (t) => {
  const site = tmp(t);
  for (const rel of ["pythonwin/scintilla.dll", "pythonwin/mfc140u.dll", "pythonwin/pywin/__init__.py", "isapi/PyISAPI_loader.dll", "win32/pythonservice.exe", "win32/perfmondata.dll", "PyWin32.chm", "win32/win32api.pyd", "win32/lib/win32con.py", "pywin32_system32/pywintypes314.dll", "pywin32.pth", "winpty/winpty.dll"]) write(site, rel);
  const drop = siteTrimPlan(site).sort();
  assert.deepEqual(drop, ["PyWin32.chm", "isapi", "pythonwin", "win32/perfmondata.dll", "win32/pythonservice.exe"]);
  // A change to the rules restages instead of reusing the marker.
  const base = { pythonEntry: { version: "1", url: "u", sha256: "s" }, uvLock: Buffer.from("lock"), extras: ["mcp"], target: "win32-x64" };
  assert.notEqual(markerHash(base), markerHash({ ...base, siteTrim: SITE_TRIM.slice(1).map(String) }));
  // What the import check needs on Windows stays.
  for (const keep of ["win32/win32api.pyd", "win32/lib/win32con.py", "pywin32_system32/pywintypes314.dll"]) assert.ok(!drop.some((d) => keep.startsWith(d)), keep);
});

test("the committed static-link records are whole: every crate and component has a stored text, and each components.json entry has a record", () => {
  const dir = path.join(repo, "apps/agent/packaging/licenses/static");
  const components = JSON.parse(readFileSync(path.join(dir, "components.json"), "utf8"));
  const records = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "components.json");
  assert.ok(records.length >= 8, records.join(", "));
  const used = new Set();
  for (const f of records) {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    assert.equal(f, `${r.dist.toLowerCase().replace(/[-_.]+/g, "-")}-${r.version}.json`);
    assert.ok(r.targets.includes("win32-x64"), `${f}: ${r.targets} (every record covers a release target)`);
    for (const e of [...r.crates, ...r.components, ...(r.rustStd ? [{ name: "std", files: r.rustStd.texts }] : [])]) {
      assert.ok(e.files.length > 0, `${f}: ${e.name} has no licence text`);
      for (const file of e.files) {
        assert.ok(existsSync(path.join(dir, "texts", `${file.text}.txt`)), `${f}: ${e.name} ${file.rel} -> ${file.text}`);
        used.add(`${file.text}.txt`);
      }
    }
  }
  for (const name of Object.keys(components).filter((k) => !k.startsWith("_"))) {
    assert.ok(records.some((f) => f.startsWith(`${name}-`)), `components.json lists ${name}, which has no record`);
  }
  assert.deepEqual(readdirSync(path.join(dir, "texts")).filter((f) => !used.has(f)), [], "texts no record uses");
  const all = readdirSync(path.join(dir, "texts")).map((f) => readFileSync(path.join(dir, "texts", f), "utf8")).join("\n");
  for (const notice of ["BoringSSL", "Eric Young"]) assert.ok(all.includes(notice), notice);
  const resvg = records.find((f) => f.startsWith("resvg-py-"));
  assert.ok(JSON.parse(readFileSync(path.join(dir, resvg), "utf8")).crates.some((c) => c.name === "tiny-skia"));
});

test("static-licenses.mjs reads crates.io index paths, Cargo.toml licence fields and SPDX expressions", () => {
  assert.equal(indexPath("a"), "1/a");
  assert.equal(indexPath("cc"), "2/cc");
  assert.equal(indexPath("syn"), "3/s/syn");
  assert.equal(indexPath("Ring"), "ri/ng/ring");
  const pkg = cargoPackage('[package]\nname = "x"\nauthors = [\n    "A <a@x>",\n    "B",\n]\nlicense = "MIT OR Apache-2.0"\nlicense-file = "LICENSE.txt"\n\n[dependencies.y]\nlicense = "GPL"\n');
  assert.deepEqual(pkg, { license: "MIT OR Apache-2.0", licenseFile: "LICENSE.txt", authors: ["A <a@x>", "B"] });
  assert.deepEqual(spdxIds("(MIT OR Apache-2.0) AND Unicode-3.0"), ["MIT", "Apache-2.0", "Unicode-3.0"]);
  assert.deepEqual(spdxIds("MIT/Apache-2.0"), ["MIT", "Apache-2.0"]);
  assert.deepEqual(spdxIds("Apache-2.0 WITH LLVM-exception"), ["Apache-2.0", "LLVM-exception"]);
});

test("a staged runtime's THIRD_PARTY_LICENSES carries the notices of the crates its Rust modules link", { skip: !existsSync(path.join(repo, "apps/web/.electron-agent/linux-x64/THIRD_PARTY_LICENSES")) && "make stage-agent first" }, () => {
  const text = readFileSync(path.join(repo, "apps/web/.electron-agent/linux-x64/THIRD_PARTY_LICENSES"), "utf8");
  for (const notice of [/ring 0\.17\.14: /, /BoringSSL/, /tiny-skia 0\.12\.0: BSD-3-Clause/, /aws-lc-sys /, /OpenSSL \d+\.\d+\.\d+ \(C library\)/, /libffi /, /libyaml /]) {
    assert.match(text, notice);
  }
});

test("fullArchiveName names the full archive of an install_only build", () => {
  assert.equal(
    fullArchiveName("cpython-3.14.9+20261021-x86_64-unknown-linux-gnu-install_only.tar.gz"),
    "cpython-3.14.9+20261021-x86_64-unknown-linux-gnu-pgo+lto-full.tar.zst",
  );
  assert.equal(
    fullArchiveName("cpython-3.14.9+20261021-x86_64-pc-windows-msvc-install_only.tar.gz"),
    "cpython-3.14.9+20261021-x86_64-pc-windows-msvc-pgo-full.tar.zst",
  );
  assert.throws(() => fullArchiveName("cpython-3.14.9-full.tar.zst"), /not an install_only archive/);
});

test("pythonLicenseRecord groups PYTHON.json's licence files by library and module", () => {
  const meta = {
    python_version: "3.14.9",
    licenses: ["Python-2.0", "CNRI-Python"],
    build_info: {
      extensions: {
        _ssl: [{ licenses: ["Apache-2.0"], license_paths: ["licenses/LICENSE.openssl-3.txt"] }],
        _hashlib: [{ licenses: ["Apache-2.0"], license_paths: ["licenses/LICENSE.openssl-3.txt"] }],
        _sqlite3: [{ licenses: [], license_paths: ["licenses/LICENSE.sqlite.txt"], license_public_domain: true }],
        math: [{}],
      },
    },
  };
  const texts = { "LICENSE.openssl-3.txt": "Apache", "LICENSE.sqlite.txt": "blessing" };
  const r = pythonLicenseRecord({ key: "linux-x64", archive: "a.tar.zst", sha256: "s", meta, texts });
  assert.deepEqual(r.libraries, [
    { file: "LICENSE.openssl-3.txt", spdx: ["Apache-2.0"], modules: ["_hashlib", "_ssl"], publicDomain: false },
    { file: "LICENSE.sqlite.txt", spdx: [], modules: ["_sqlite3"], publicDomain: true },
  ]);
  assert.throws(() => pythonLicenseRecord({ key: "k", archive: "a", sha256: "s", meta, texts: {} }), /names licenses\/LICENSE\.openssl-3\.txt, which the archive does not hold/);
});

test("pythonLicenseRecord takes the bundled library's text for a module PYTHON.json gives no licence path (Windows' pyexpat, _decimal, zlib)", () => {
  const meta = {
    python_version: "3.14.9",
    build_info: {
      extensions: {
        _ssl: [{ licenses: ["Apache-2.0"], license_paths: ["licenses/LICENSE.openssl-3.txt"] }],
        pyexpat: [{ shared_lib: "install/DLLs/pyexpat.pyd" }],
        _decimal: [{ shared_lib: "install/DLLs/_decimal.pyd" }],
        zlib: [{ in_core: true }],
      },
    },
  };
  const texts = { "LICENSE.openssl-3.txt": "Apache", "LICENSE.expat.txt": "MIT", "LICENSE.mpdecimal.txt": "BSD", "LICENSE.zlib-ng.txt": "zlib" };
  const r = pythonLicenseRecord({ key: "win32-x64", archive: "a.tar.zst", sha256: "s", meta, texts });
  assert.deepEqual(
    r.libraries.map((l) => [l.file, l.spdx, l.modules]),
    [
      ["LICENSE.expat.txt", ["MIT"], ["pyexpat"]],
      ["LICENSE.mpdecimal.txt", ["BSD-2-Clause"], ["_decimal"]],
      ["LICENSE.openssl-3.txt", ["Apache-2.0"], ["_ssl"]],
      ["LICENSE.zlib-ng.txt", ["Zlib"], ["zlib"]],
    ],
  );
  // A module with its own licence path keeps it; a missing fallback text fails.
  meta.build_info.extensions.pyexpat = [{ licenses: ["MIT"], license_paths: ["licenses/LICENSE.expat.txt"] }];
  assert.deepEqual(pythonLicenseRecord({ key: "k", archive: "a", sha256: "s", meta, texts }).libraries.find((l) => l.file === "LICENSE.expat.txt").modules, ["pyexpat"]);
  delete texts["LICENSE.mpdecimal.txt"];
  assert.throws(() => pythonLicenseRecord({ key: "k", archive: "a", sha256: "s", meta, texts }), /_decimal has no licence path and the archive holds no LICENSE\.mpdecimal\.txt/);
});

test("a shipped pyexpat, _decimal or zlib1.dll whose library the interpreter's licence record lacks fails the stage", (t) => {
  const root = tmp(t);
  write(root, "DLLs/_decimal.pyd");
  write(root, "DLLs/pyexpat.pyd");
  write(root, "DLLs/zlib1.dll");
  write(root, "DLLs/_ssl.pyd");
  write(root, "python314.dll");
  const before = [{ file: "LICENSE.openssl-3.txt", modules: ["_hashlib", "_ssl"] }];
  assert.deepEqual(interpreterModuleProblems(root, before).map((p) => p.split(" ")[0]).sort(), ["python/DLLs/_decimal.pyd", "python/DLLs/pyexpat.pyd", "python/DLLs/zlib1.dll"]);
  assert.match(interpreterModuleProblems(root, before).join("\n"), /links mpdecimal, which the interpreter's licence record does not cover: run make agent-python-licenses/);
  const after = [...before, { file: "LICENSE.expat.txt", modules: ["pyexpat"] }, { file: "LICENSE.mpdecimal.txt", modules: ["_decimal"] }, { file: "LICENSE.zlib-ng.txt", modules: ["zlib"] }];
  assert.deepEqual(interpreterModuleProblems(root, after), []);
  write(root, "lib/python3.14/lib-dynload/_decimal.cpython-314-x86_64-linux-gnu.so");
  assert.equal(interpreterModuleProblems(root, before).filter((p) => p.includes("lib-dynload")).length, 1);
});

test("cpythonIncorporated keeps Doc/license.rst's incorporated-software section and adds the HACL* licence", () => {
  const rst = "CPython\n=======\n\nPSF text\n\nLicenses and Acknowledgements for Incorporated Software\n=======================================================\n\nmimalloc\n--------\n\n   Copyright (c) 2018-2021 Microsoft Corporation, Daan Leijen\n";
  const hacl = "/* MIT License\n *\n * Copyright (c) 2016-2022 INRIA, CMU and Microsoft Corporation\n *\n * Permission is hereby granted\n */\n\n#include \"x.h\"\n";
  const text = cpythonIncorporated({ rst, hacl, python: "3.14.9" });
  assert.match(text, /blob\/v3\.14\.9\/Doc\/license\.rst/);
  assert.doesNotMatch(text, /PSF text/);
  assert.match(text, /^Licenses and Acknowledgements for Incorporated Software\n=+\n\nmimalloc/m);
  assert.match(text, /HACL\*\n-----\n[\s\S]*\n {3}MIT License\n\n {3}Copyright \(c\) 2016-2022 INRIA, CMU and Microsoft Corporation\n\n {3}Permission is hereby granted\n$/);
  assert.throws(() => cpythonIncorporated({ rst: "no section", hacl, python: "3.14.9" }), /has no "Licenses and Acknowledgements/);
  assert.throws(() => cpythonIncorporated({ rst, hacl: "#include", python: "3.14.9" }), /MIT licence header/);
});

test("every desktop target has the licences of the interpreter's built-in libraries for the pinned Python, and they reach THIRD_PARTY_LICENSES", (t) => {
  const lock = JSON.parse(readFileSync(path.join(repo, "apps/agent/hermes/pm/lock.json"), "utf8"));
  const version = lock.packages.python.version;
  const root = path.join(repo, "apps/agent/packaging/python-licenses");
  for (const key of Object.keys(TARGETS)) {
    const libs = interpreterLicenses(root, version, key);
    const openssl = libs.find((l) => l.modules.includes("_ssl"));
    assert.ok(openssl, `${key}: OpenSSL`);
    assert.deepEqual(openssl.spdx, ["Apache-2.0"]);
    assert.match(openssl.text, /Apache License/);
    for (const lib of libs) assert.ok(lib.text.trim().length > 0 && !lib.text.includes("\r"), `${key}: ${lib.file}`);
    const record = JSON.parse(readFileSync(path.join(root, version, `${key}.json`), "utf8"));
    assert.equal(record.archive, fullArchiveName(decodeURIComponent(path.posix.basename(new URL(lock.packages.python.artifacts[key].url).pathname))));
    // Windows too: its PYTHON.json gives pyexpat, _decimal and zlib no licence path (BUNDLED_LIBRARIES).
    for (const m of ["_ctypes", "_decimal", "pyexpat", "_lzma", "_bz2", "zlib", "_zstd"]) assert.ok(libs.some((l) => l.modules.includes(m)), `${key}: ${m}`);
    const incorporated = incorporatedLicenses(root, version);
    const text = thirdPartyLicenses({ cpython: "PSF", incorporated, interpreter: libs, hermes: "MIT", notice: "N", dists: [] });
    assert.match(text, /Libraries built into the interpreter/);
    assert.match(text, /--- openssl-3: Apache-2\.0 \(used by _hashlib, _ssl\)/);
    assert.match(text, /Software incorporated in CPython \(python\/\)/);
    // What CPython compiles into the interpreter itself, and the libraries Windows builds into DLLs/*.pyd.
    for (const notice of ["HACL*", "INRIA, CMU and Microsoft", "Daan Leijen", "David M. Gay", "SipHash", "Makoto Matsumoto", "Don Owens", "Ma Lin", "Thai Open Source Software Center", "Stefan Krah", "Jean-loup Gailly"]) {
      assert.ok(text.includes(notice), `${key}: ${notice}`);
    }
  }
  const win = interpreterLicenses(root, version, "win32-x64");
  for (const [module, lib] of Object.entries(BUNDLED_LIBRARIES)) assert.ok(win.some((l) => l.file === lib.file && l.modules.includes(module)), `win32-x64: ${module} -> ${lib.file}`);
  assert.throws(() => interpreterLicenses(root, "3.99.0+1", "linux-x64"), /make agent-python-licenses/);
  assert.throws(() => incorporatedLicenses(root, "3.99.0+1"), /make agent-python-licenses/);
  void t;
});

// ------------------------------------------------------------ manifest and read-only smoke

test("listTree lists files with sizes and links, leaving out MANIFEST.json", (t) => {
  const root = tmp(t);
  write(root, "b/two.txt", "22");
  write(root, "a.txt", "1");
  write(root, "MANIFEST.json", "{}");
  if (posix) symlinkSync("a.txt", path.join(root, "link"));
  const { files: list, links } = listTree(root);
  assert.deepEqual(list, [["a.txt", 1], ["b/two.txt", 2]]);
  assert.deepEqual(links, posix ? [["link", "a.txt"]] : []);
  assert.deepEqual(largestFolders([["app/x/y/z.py", 5], ["app/x/w/q.py", 7], ["python/lib/a/b", 3]], { depth: 3, top: 2 }), [["app", 12], ["app/x/w", 7]]);
});

test("diffSnapshots names created, removed and changed paths", (t) => {
  const root = tmp(t);
  write(root, "keep.txt", "same");
  write(root, "change.txt", "one");
  write(root, "gone.txt", "bye");
  const before = snapshot(root);
  write(root, "change.txt", "three");
  utimesSync(path.join(root, "change.txt"), new Date(2020, 1, 1), new Date(2020, 1, 1));
  rmSync(path.join(root, "gone.txt"));
  write(root, "pkg/__pycache__/m.cpython-314.pyc", "pyc");
  const d = diffSnapshots(before, snapshot(root));
  assert.deepEqual(d.created.sort(), ["pkg", "pkg/__pycache__", "pkg/__pycache__/m.cpython-314.pyc"]);
  assert.deepEqual(d.removed, ["gone.txt"]);
  assert.deepEqual(d.changed, ["change.txt"]);
  assert.deepEqual(diffSnapshots(before, before), { created: [], removed: [], changed: [] });
});

test("makeReadOnly gives 0444 files and 0555 folders; makeWritable undoes it", { skip: !posix && "POSIX modes" }, (t) => {
  const root = path.join(tmp(t), "skills");
  write(root, "timely/SKILL.md", "x");
  makeReadOnly(root);
  assert.equal(statSync(path.join(root, "timely/SKILL.md")).mode & 0o777, 0o444);
  assert.equal(statSync(path.join(root, "timely")).mode & 0o777, 0o555);
  assert.equal(statSync(root).mode & 0o777, 0o555);
  makeWritable(root);
  rmSync(root, { recursive: true });
  assert.ok(!existsSync(root));
});

test("smoke-agent's lockTree makes the tree read-only and restores every mode", { skip: !posix && "icacls is Windows-only" }, (t) => {
  const root = path.join(tmp(t), "agent");
  write(root, "boot.py", "x");
  write(root, "app/skills/s/SKILL.md", "x");
  makeReadOnly(path.join(root, "app/skills"));
  chmodSync(path.join(root, "boot.py"), 0o640);
  const before = new Map(listTree(root).files.map(([rel]) => [rel, statSync(path.join(root, rel)).mode & 0o7777]));
  const restore = lockTree(root);
  try {
    assert.equal(statSync(path.join(root, "boot.py")).mode & 0o222, 0);
    assert.equal(statSync(path.join(root, "app")).mode & 0o222, 0);
    if (process.getuid?.() !== 0) assert.throws(() => writeFileSync(path.join(root, "app", "new.txt"), "x"), /EACCES|EPERM/);
  } finally {
    restore();
  }
  for (const [rel, mode] of before) assert.equal(statSync(path.join(root, rel)).mode & 0o7777, mode, rel);
  assert.equal(statSync(path.join(root, "app/skills")).mode & 0o777, 0o555);
  writeFileSync(path.join(root, "app", "new.txt"), "x");
});

test("smoke-agent's Windows lock denies Write, Delete and DeleteSubdirectoriesAndFiles through .NET, never through icacls", () => {
  // icacls adds SYNCHRONIZE to every deny ACE (and its W already holds it). Inherited by
  // every entry, a SYNCHRONIZE deny on Everyone refuses python.exe's image load and every
  // open(), so the read-only smoke failed before step 1 and release.yml built no Windows installer.
  const source = readFileSync(path.join(repo, "apps/web/electron/smoke-agent.mjs"), "utf8");
  assert.doesNotMatch(source, /["'`]icacls(\.exe)?["'`]/);
  const root = "C:\\a b\\agent";
  for (const action of ["lock", "unlock"]) {
    const { cmd, args, env } = windowsLockCommand(root, action);
    assert.equal(cmd, "powershell.exe");
    assert.equal(env.TIMELY_SMOKE_ROOT, root);
    assert.equal(env.TIMELY_SMOKE_ACTION, action);
    const i = args.indexOf("-EncodedCommand");
    assert.ok(i >= 0, args.join(" "));
    const script = Buffer.from(args[i + 1], "base64").toString("utf16le");
    assert.ok(!script.includes(root), "the root goes through the environment, not the script");
    assert.match(script, /FileSystemRights\]'Write, Delete, DeleteSubdirectoriesAndFiles'/);
    assert.match(script, /AccessControlType\]::Deny\)/);
    assert.match(script, /'S-1-1-0'/);
    assert.match(script, /InheritanceFlags\]'ContainerInherit, ObjectInherit'/);
    // Only the rule's own rights name, and the after-check that throws on SYNCHRONIZE.
    const rights = [...script.matchAll(/FileSystemRights\]'([^']*)'/g)].map((m) => m[1]);
    assert.deepEqual(rights, ["Write, Delete, DeleteSubdirectoriesAndFiles"]);
    assert.doesNotMatch(script, /FullControl|Modify|ReadAndExecute|GenericWrite/);
    assert.match(script, /FileSystemRights\]::Synchronize\) -ne 0\) \{ throw/);
  }
  assert.throws(() => windowsLockCommand(root, "deny"), /action/);
});

// ------------------------------------------------------------ the boot.py shim

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return "";
}

test("the boot.py shim runs app/timely_agent/boot.py as __main__ without its own folder on sys.path", { skip: !findPython() && "no python3" }, (t) => {
  const root = tmp(t);
  copyFileSync(path.join(repo, "apps/agent/packaging/boot.py"), path.join(root, "boot.py"));
  write(root, "json.py", "raise SystemExit('the shim folder was imported from')\n");
  write(
    root,
    "app/timely_agent/boot.py",
    [
      "import json, os, sys",
      "root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))",
      "print(json.dumps({'name': __name__, 'file': os.path.relpath(__file__, root), 'root_on_path': any(os.path.abspath(p) == root for p in sys.path if p),",
      "                  'no_bytecode': sys.dont_write_bytecode, 'argv': sys.argv[1:]}))",
      "sys.exit(3)",
      "",
    ].join("\n"),
  );
  const r = spawnSync(findPython(), ["-I", path.join(root, "boot.py"), "prepare", "--agent-dir", "x"], { encoding: "utf8", cwd: root });
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    name: "__main__",
    file: path.join("app", "timely_agent", "boot.py"),
    root_on_path: false,
    no_bytecode: true,
    argv: ["prepare", "--agent-dir", "x"],
  });
  assert.ok(!readdirSync(root).includes("__pycache__"));
});

test("the import check needs the MCP SDK everywhere and pywin32 and portalocker on Windows, through boot.py's sys.path", { skip: !findPython() && "no python3" }, (t) => {
  const root = tmp(t);
  const app = path.join(root, "app");
  copyFileSync(path.join(repo, "apps/agent/timely_agent/boot.py"), write(app, "timely_agent/boot.py"));
  mkdirSync(path.join(app, "hermes"));
  write(app, "site-packages/mcp/__init__.py", "");
  write(app, "site-packages/mcp/client/__init__.py", "");
  write(app, "site-packages/mcp/client/stdio.py", "import pywintypes\n");
  const run = (platform) => {
    const r = spawnSync(findPython(), ["-I", "-B", "-c", importCheckSource(path.join(app, "timely_agent", "boot.py"), platform)], { encoding: "utf8", cwd: root });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };
  // pywintypes sits in win32/lib, reachable only through the .pth (pywin32's layout).
  let got = run("linux");
  assert.deepEqual(got.checked, ["mcp", "mcp.client.stdio"]);
  assert.match(got.failed["mcp.client.stdio"], /No module named 'pywintypes'/);
  write(app, "site-packages/win32/lib/pywintypes.py", "");
  write(app, "site-packages/pywin32.pth", "win32\nwin32/lib\n");
  assert.deepEqual(run("linux").failed, {});
  got = run("win32");
  assert.deepEqual(Object.keys(got.failed).sort(), ["portalocker", "win32api", "win32con", "win32job"]);
  for (const name of ["win32/win32api.py", "win32/win32con.py", "win32/win32job.py", "portalocker/__init__.py"]) write(app, `site-packages/${name}`, "");
  assert.deepEqual(run("win32").failed, {});
});

// ------------------------------------------------------------ pinned tools

test("every setup-uv step pins the uv the Docker image copies, so desktop and Docker runtimes are staged by the same uv", () => {
  const docker = readFileSync(path.join(repo, "apps/api/Dockerfile"), "utf8");
  const pinned = /ghcr\.io\/astral-sh\/uv:([0-9.]+)@sha256:[0-9a-f]{64}/.exec(docker)?.[1];
  assert.ok(pinned, "the Dockerfile copies uv by version and digest");
  for (const file of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    const lines = readFileSync(path.join(repo, file), "utf8").split("\n");
    const steps = lines.flatMap((line, i) => (/uses: astral-sh\/setup-uv@/.test(line) ? [i] : []));
    assert.ok(steps.length > 0, file);
    for (const i of steps) {
      const block = [];
      for (let j = i + 1; j < lines.length && !/^\s*- /.test(lines[j]); j++) block.push(lines[j]);
      assert.match(block.join("\n"), new RegExp(`version: "${pinned.replaceAll(".", "\\.")}"`), `${file}:${i + 1}`);
    }
  }
});

test("every stage of the API image is pinned by digest", () => {
  const docker = readFileSync(path.join(repo, "apps/api/Dockerfile"), "utf8");
  const froms = docker.split("\n").filter((line) => /^FROM\s/i.test(line));
  assert.ok(froms.length >= 3);
  for (const line of froms) assert.match(line, /@sha256:[0-9a-f]{64}(\s|$)/, line);
});

test("the docker CI job runs on a PR that changes anything the image copies, its smoke test reads, or the job itself", () => {
  const ci = readFileSync(path.join(repo, ".github/workflows/ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("\n  docker:"));
  const list = /git diff --quiet "origin\/\$BASE_REF\.\.\.HEAD" -- ((?:[^;]|\\\n)+?); then/.exec(job)?.[1];
  assert.ok(list, "the docker job's path filter");
  const paths = list.split(/\s+/).filter((p) => p && p !== "\\");
  const covered = (p) => paths.some((f) => p === f || p.startsWith(`${f}/`));
  const docker = readFileSync(path.join(repo, "apps/api/Dockerfile"), "utf8");
  const sources = docker
    .split("\n")
    .filter((line) => /^COPY\s/.test(line) && !/--from=/.test(line))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1));
  assert.ok(sources.includes("Makefile") && sources.includes("apps/api"));
  for (const src of [...sources, "apps/api/Dockerfile", "scripts/docker-agent-smoke.sh", ".github/workflows/ci.yml"]) assert.ok(covered(src), `${src} is not in the docker job's filter`);
});

test("make docker-agent-smoke builds in a throwaway builder that its trap removes, so no build cache stays behind", () => {
  const script = readFileSync(path.join(repo, "scripts/docker-agent-smoke.sh"), "utf8");
  assert.match(script, /docker buildx create --name "\$builder" --driver docker-container/);
  assert.match(script, /docker buildx build --builder "\$builder" --load /);
  assert.doesNotMatch(script, /^\s*(DOCKER_BUILDKIT=1 )?docker build /m, "a plain docker build fills the default builder's cache");
  const cleanup = script.slice(script.indexOf("cleanup() {"), script.indexOf("trap cleanup EXIT"));
  assert.match(cleanup, /docker buildx rm "\$builder"/);
  assert.match(cleanup, /docker image rm "\$buildkit_image"/);
});

test("docker compose pins the image's agent runtime, so the shared root .env cannot point it at a host path", () => {
  const docker = readFileSync(path.join(repo, "apps/api/Dockerfile"), "utf8");
  const runtime = /TIMELY_AGENT_RUNTIME=(\S+)/.exec(docker)?.[1];
  assert.equal(runtime, "/app/agent");
  const compose = readFileSync(path.join(repo, "docker-compose.yml"), "utf8");
  const api = compose.slice(compose.indexOf("\n  api:"));
  const env = `${api.slice(api.indexOf("    environment:"), api.indexOf("\n    ports:"))}\n`;
  assert.match(env, new RegExp(`\\n      TIMELY_AGENT_RUNTIME: ${runtime}\\n`));
  assert.match(env, /\n      TIMELY_DATA_DIR: \/data\n/);
});

// ------------------------------------------------------------ Windows checkouts

test("apps/agent is checked out byte for byte on every OS, so skill tree ids match skills-reviewed.json", () => {
  // Git for Windows defaults to core.autocrlf=true: an extensionless LICENSE in a seed skill
  // came out with CRLF, its tree id changed and the Windows stage's seed check failed.
  const attrs = readFileSync(path.join(repo, "apps/agent/.gitattributes"), "utf8");
  assert.match(attrs, /^\* -text$/m);
  const probe = ["apps/agent/hermes/skills/creative/humanizer/LICENSE", "apps/agent/timely_agent/seed.py", "apps/agent/packaging/boot.py"];
  const r = spawnSync("git", ["check-attr", "text", "eol", "--", ...probe], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) return; // not a git checkout (the Docker build stage)
  const humanizer = r.stdout.split("\n").filter((l) => l.startsWith(probe[0]));
  assert.ok(humanizer.some((l) => l.endsWith(": text: unset")), r.stdout);

  // Every file of every bundled and offered skill: vendored hermes/.gitattributes is more
  // specific than `* -text` and checks *.ps1 out with CRLF, which would change the skill's
  // tree id on disk (seed.git_tree_id) on every OS and drop it as unreviewed.
  const reviewed = JSON.parse(readFileSync(path.join(repo, "apps/agent/.hermes-sync/policy/skills-reviewed.json"), "utf8")).skills;
  const shipped = Object.entries(reviewed)
    .filter(([rel, e]) => rel.startsWith("skills/") || e.offered === true)
    .map(([rel]) => `apps/agent/hermes/${rel}`);
  assert.ok(shipped.length > 30, String(shipped.length));
  const ls = spawnSync("git", ["ls-files", "-z", "--", ...shipped], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1048576 });
  const paths = ls.stdout.split("\0").filter(Boolean);
  assert.ok(paths.length > shipped.length, String(paths.length));
  const fileAttrs = new Map();
  for (let i = 0; i < paths.length; i += 500) {
    const a = spawnSync("git", ["check-attr", "-z", "text", "eol", "working-tree-encoding", "ident", "filter", "--", ...paths.slice(i, i + 500)], { cwd: repo, encoding: "utf8" });
    const f = a.stdout.split("\0");
    for (let j = 0; j + 2 < f.length; j += 3) fileAttrs.set(f[j], { ...fileAttrs.get(f[j]), [f[j + 1]]: f[j + 2] });
  }
  const rewritten = [...fileAttrs]
    .filter(([, a]) => a.eol === "crlf" || (["set", "auto"].includes(a.text) && a.eol !== "lf") || ["working-tree-encoding", "ident", "filter"].some((k) => !["unspecified", "unset"].includes(a[k])))
    .map(([p, a]) => `${p} ${JSON.stringify(a)}`);
  assert.deepEqual(rewritten, [], "a shipped skill file whose checkout differs from its blob");
});

test("every Windows job turns core.autocrlf off before checking out", () => {
  const jobs = { ".github/workflows/ci.yml": ["agent-windows", "agent-stage"], ".github/workflows/release.yml": ["desktop"] };
  for (const [file, names] of Object.entries(jobs)) {
    const text = readFileSync(path.join(repo, file), "utf8");
    for (const name of names) {
      const start = text.indexOf(`\n  ${name}:\n`);
      assert.ok(start >= 0, `${file} ${name}`);
      const rest = text.slice(start + 1);
      const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
      const job = next < 0 ? rest : rest.slice(0, next + 1);
      assert.match(job, /windows-latest/, `${file} ${name} runs on Windows`);
      const off = job.indexOf("git config --global core.autocrlf false");
      const checkout = job.indexOf("uses: actions/checkout@");
      assert.ok(off >= 0 && off < checkout, `${file} ${name}: core.autocrlf false before actions/checkout`);
    }
  }
});

// ------------------------------------------------------------ packaging wiring

test("every installer packs the staged runtime and checks it: the extraResources entry and the afterPack hook", () => {
  // Deleting either line shipped installers without the agent runtime while every other check passed.
  const yml = readFileSync(path.join(repo, "apps/web/electron-builder.yml"), "utf8");
  assert.match(yml, /\n {2}- from: \.electron-agent\/\$\{os\}-\$\{arch\}\n {4}to: agent\n/);
  assert.match(yml, /^afterPack: electron\/verify-pack\.cjs$/m);
  const local = readFileSync(path.join(repo, "apps/web/electron-builder.local.yml"), "utf8");
  assert.match(local, /^extends: electron-builder\.yml$/m);
  assert.doesNotMatch(local, /^(extraResources|afterPack):/m, "the local build would replace the release wiring");
});

test("the release packs the stage its smoke step checked, not a second stage", () => {
  const release = readFileSync(path.join(repo, ".github/workflows/release.yml"), "utf8");
  const stage = release.indexOf("node electron/stage-agent.mjs");
  const smoke = release.indexOf("node electron/smoke-agent.mjs --read-only");
  const pack = release.indexOf("node electron/pack.mjs");
  assert.ok(stage > 0 && stage < smoke && smoke < pack);
  const packStep = release.slice(release.lastIndexOf("- name:", pack), pack);
  assert.match(packStep, /TIMELY_AGENT_STAGED: "1"/);
  const packJs = readFileSync(path.join(repo, "apps/web/electron/pack.mjs"), "utf8");
  assert.match(packJs, /process\.env\.TIMELY_AGENT_STAGED === "1"\) reuseStagedAgent\(targets\)/);
});

test("stagedManifest accepts only a finished stage for the target", (t) => {
  const out = tmp(t);
  assert.throws(() => stagedManifest(out, "linux-x64"), /no MANIFEST\.json/);
  writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify({ target: "linux-x64", marker: ".staged-abc", totals: { files: 1, bytes: 2 } }));
  assert.throws(() => stagedManifest(out, "win32-x64"), /not win32-x64/);
  assert.throws(() => stagedManifest(out, "linux-x64"), /marker/);
  write(out, ".staged-abc");
  assert.equal(stagedManifest(out, "linux-x64").totals.files, 1);
});

test("a stage left from before a Hermes sync or a source change is refused when packed with TIMELY_AGENT_STAGED=1", (t) => {
  const out = tmp(t);
  writeFileSync(
    path.join(out, "MANIFEST.json"),
    JSON.stringify({ target: "linux-x64", marker: ".staged-abc", hermesTag: "v0.23.0", sources: "s1", totals: { files: 1, bytes: 2 } }),
  );
  write(out, ".staged-abc");
  const same = { marker: ".staged-abc", hermesTag: "v0.23.0", sources: "s1" };
  assert.equal(stagedManifest(out, "linux-x64", same).hermesTag, "v0.23.0");
  assert.throws(() => stagedManifest(out, "linux-x64", { ...same, marker: ".staged-def" }), /stale: it was installed from other inputs.*Stage it again/);
  assert.throws(() => stagedManifest(out, "linux-x64", { ...same, hermesTag: "v0.99.0" }), /stale: it holds Hermes v0\.23\.0, the checkout has v0\.99\.0/);
  assert.throws(() => stagedManifest(out, "linux-x64", { ...same, sources: "s2" }), /stale: apps\/agent changed since it was staged/);
  // No checkout (sources null): only the marker and the tag are compared.
  assert.equal(stagedManifest(out, "linux-x64", { ...same, sources: null }).target, "linux-x64");
  // reuseStagedAgent compares all three.
  const stage = readFileSync(path.join(repo, "apps/web/electron/stage-agent.mjs"), "utf8");
  const reuse = stage.slice(stage.indexOf("export function reuseStagedAgent"));
  assert.match(reuse, /stagedManifest\(out, target\.key, \{ marker: stageMarker\(inputs, target\.key\), hermesTag: inputs\.hermesTag, sources \}\)/);
});

test("sourceHash covers the path and bytes of every tracked file under apps/agent, and is null without a checkout", (t) => {
  const root = tmp(t);
  write(root, "apps/agent/a.py", "one");
  write(root, "apps/agent/hermes/b.py", "two");
  write(root, "apps/agent/untracked.env", "secret");
  const tracked = new Set(["apps/agent/a.py", "apps/agent/hermes/b.py", "apps/web/x.ts"]);
  const first = sourceHash(root, tracked);
  assert.match(first, /^[0-9a-f]{16}$/);
  write(root, "apps/agent/untracked.env", "other");
  write(root, "apps/web/x.ts", "web");
  assert.equal(sourceHash(root, tracked), first, "untracked files and other apps do not count");
  write(root, "apps/agent/hermes/b.py", "three");
  assert.notEqual(sourceHash(root, tracked), first);
  rmSync(path.join(root, "apps/agent/a.py"));
  assert.notEqual(sourceHash(root, tracked), first);
  assert.equal(sourceHash(root, null), null);
});
