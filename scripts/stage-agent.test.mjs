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
  MAX_PATH_CHARS,
  PIP_INSTALL_FLAGS,
  STAGE_FORMAT,
  TRIM,
  assertHostTarget,
  assertHostTargets,
  checkTree,
  collectLicenses,
  cpythonLicense,
  diffSnapshots,
  dropLongBytecode,
  hermesCopyFilter,
  importCheckSource,
  importsStdlibTest,
  largestFolders,
  listTree,
  makeReadOnly,
  makeWritable,
  makefileVar,
  markerHash,
  parseExtras,
  parseMetadata,
  pythonArtifact,
  scratchRootFor,
  selectSkills,
  snapshot,
  stagedPython,
  stdlibDir,
  thirdPartyLicenses,
  trimPlan,
} from "../apps/web/electron/stage-agent-lib.mjs";
import { lockTree } from "../apps/web/electron/smoke-agent.mjs";
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

test("make stage-desktop stages the agent for the host only, whatever TIMELY_TARGETS says", () => {
  const make = readFileSync(path.join(repo, "Makefile"), "utf8");
  const recipe = /^stage-desktop:.*\n((?:\t.*\n)+)/m.exec(make)?.[1] ?? "";
  assert.match(recipe, /TIMELY_TARGETS= node \$\(WEB\)\/electron\/stage-agent\.mjs/);
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

test("a change to the trim rules or the install flags restages instead of reusing the marker", () => {
  const base = { pythonEntry: { version: "1", url: "u", sha256: "s" }, uvLock: Buffer.from("lock"), extras: ["mcp"], target: "linux-x64" };
  const h = markerHash(base);
  assert.equal(markerHash({ ...base, trim: TRIM.map(String), install: PIP_INSTALL_FLAGS }), h);
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
  ]));
  assert.equal(cpythonLicense(py), "lib/python3.14/LICENSE.txt");
  assert.equal(stdlibDir(py), path.join(py, "lib", "python3.14"));
});

test("trimPlan covers the Windows layout (Lib, DLLs, libs, Scripts, tcl)", (t) => {
  const py = path.join(tmp(t), "python");
  for (const rel of [
    "python.exe", "python314.dll", "LICENSE.txt", "include/Python.h", "libs/python314.lib", "Scripts/pip.exe", "tcl/tcl9.0/init.tcl",
    "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "DLLs/_ssl.pyd", "Lib/os.py", "Lib/tkinter/__init__.py",
    "Lib/idlelib/x.py", "Lib/test/x.py", "Lib/site-packages/pip/__init__.py",
  ]) write(py, rel);
  const { drop, tests } = trimPlan(py);
  assert.deepEqual(tests, ["Lib/test"]);
  assert.deepEqual(new Set(drop), new Set([
    "include", "libs", "Scripts", "tcl", "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll", "Lib/tkinter", "Lib/idlelib",
    "Lib/site-packages/pip",
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

test("collectLicenses takes licence files and metadata, and names distributions with neither", (t) => {
  const site = tmp(t);
  write(site, "files_only-1.0.dist-info/METADATA", "Name: files-only\nVersion: 1.0\n\n");
  write(site, "files_only-1.0.dist-info/licenses/LICENSE.txt", "MIT text\n");
  write(site, "files_only-1.0.dist-info/licenses/vendor/NOTICE", "notice text\n");
  write(site, "expr-2.0.dist-info/METADATA", "Name: expr\nVersion: 2.0\nLicense-Expression: Apache-2.0\n\n");
  write(site, "old-3.0.dist-info/METADATA", "Name: old\nVersion: 3.0\nLicense-File: COPYING\n\n");
  write(site, "old-3.0.dist-info/COPYING", "GPL? no, BSD\n");
  write(site, "classified-1.dist-info/METADATA", "Name: classified\nVersion: 1\nClassifier: License :: OSI Approved :: MIT License\n\n");
  write(site, "bare-0.1.dist-info/METADATA", "Name: bare\nVersion: 0.1\n\n");
  write(site, "bare/__init__.py");
  const { dists, missing } = collectLicenses(site);
  assert.deepEqual(missing, ["bare"]);
  const by = Object.fromEntries(dists.map((d) => [d.name, d]));
  assert.deepEqual(by["files-only"].files.map((f) => f.rel).sort(), ["licenses/LICENSE.txt", "licenses/vendor/NOTICE"]);
  assert.equal(by.expr.license, "Apache-2.0");
  assert.deepEqual(by.old.files.map((f) => f.rel), ["COPYING"]);
  assert.equal(by.classified.license, "License :: OSI Approved :: MIT License");
  const text = thirdPartyLicenses({ cpython: "PSF", hermes: "MIT Nous", notice: "Timely NOTICE", dists });
  for (const needle of ["PSF", "MIT Nous", "Timely NOTICE", "files-only 1.0", "MIT text", "notice text", "expr 2.0 (app/site-packages/expr-2.0.dist-info): Apache-2.0", "BSD"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(text.indexOf("PSF") < text.indexOf("MIT Nous") && text.indexOf("MIT Nous") < text.indexOf("Timely NOTICE"));
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

test("the docker CI job runs on a PR that changes anything the image copies or its smoke test reads", () => {
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
  for (const src of [...sources, "apps/api/Dockerfile", "scripts/docker-agent-smoke.sh"]) assert.ok(covered(src), `${src} is not in the docker job's filter`);
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
