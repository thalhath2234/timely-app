// Smoke-test a staged agent runtime the way the API runs it (plan 11.4,
// phase 3b work packages "stage-agent"):
//
//   1. `python -I <root>/boot.py` with no command exits 2 with the usage line;
//   2. `boot.py prepare --agent-dir <scratch>` exits 0 (Hermes imports, managed canary);
//   3. the MCP SDK (and on Windows pywin32 and portalocker) import through boot.py's sys.path;
//   4. the Go real-worker test (TestIntegrationRealWorker) with
//      TIMELY_AGENT_TEST_RUNTIME=<root>: prepare, render-account, spawn, hello,
//      ready with the self-test, a run on the Go stub model, run.done, shutdown.
//
// With --read-only the root is made read-only first (POSIX: chmod a-w on every
// entry; Windows: an inherited deny ACE for Everyone on write, delete and
// delete-child, without SYNCHRONIZE: see windowsLockCommand), every step runs against
// it, and any file or folder created, removed or changed inside the root fails
// the smoke. Permissions are restored in every case.
//
//   node electron/smoke-agent.mjs [--root <agent dir>] [--read-only]
//
// Default root: .electron-agent/<host stageDir>. Needs Go on PATH. Scratch
// folders go under ~/.cache/timely-agent-stage/<checkout id> and are removed afterwards.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffSnapshots, importCheckSource, makeWritable, scratchRootFor, snapshot, stagedPython, walk } from "./stage-agent-lib.mjs";
import { getTarget, hostTargetKey } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
const apiRoot = path.join(webRoot, "..", "api");
const scratchRoot = scratchRootFor(path.join(webRoot, "..", ".."));

function parseArgs(argv) {
  const opts = { root: "", readOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--read-only") opts.readOnly = true;
    else if (a === "--root") opts.root = argv[++i] ?? "";
    else if (a.startsWith("--root=")) opts.root = a.slice(7);
    else throw new Error(`unknown argument ${a} (use --root <agent dir>, --read-only)`);
  }
  opts.root = path.resolve(opts.root || path.join(webRoot, ".electron-agent", getTarget(hostTargetKey()).stageDir));
  return opts;
}

/** Environment for the runtime: nothing of the developer's (no HERMES_*, keys or PYTHON*). */
function cleanEnv(home) {
  const env = { HOME: home, USERPROFILE: home, LANG: "C.UTF-8" };
  // Windows names are case-insensitive: copy each one once, under the name it has.
  const keep = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TEMP", "TMP"]);
  for (const [name, value] of Object.entries(process.env)) {
    if (keep.has(name.toUpperCase()) && value !== undefined) env[name] = value;
  }
  return env;
}

// The deny ACE is written through .NET, not icacls: icacls adds SYNCHRONIZE to every
// deny ACE it writes (and its W already holds it), and a SYNCHRONIZE deny on Everyone,
// inherited by every entry, refuses each open and image load, python.exe's included.
// FileSystemAccessRule drops SYNCHRONIZE from a Deny rule; the script checks it did.
const WINDOWS_LOCK_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$everyone = New-Object System.Security.Principal.SecurityIdentifier 'S-1-1-0'
$rights = [System.Security.AccessControl.FileSystemRights]'Write, Delete, DeleteSubdirectoriesAndFiles'
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, $rights, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Deny)
$dir = Get-Item -LiteralPath $env:TIMELY_SMOKE_ROOT
$acl = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
if ($env:TIMELY_SMOKE_ACTION -eq 'lock') { $acl.AddAccessRule($rule) } else { [void]$acl.RemoveAccessRule($rule) }
$dir.SetAccessControl($acl)
$denied = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access).GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Deny' -and $_.IdentityReference -eq $everyone }
if ($env:TIMELY_SMOKE_ACTION -eq 'lock') {
  if (-not $denied) { throw 'the deny ACE for Everyone is missing after Set' }
  foreach ($r in $denied) { if (($r.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Synchronize) -ne 0) { throw "the deny ACE for Everyone holds SYNCHRONIZE: $($r.FileSystemRights)" } }
} elseif ($denied) { throw 'a deny ACE for Everyone is still there after Remove' }`;

/**
 * The Windows lock or unlock of `root`: Windows PowerShell adds (or removes)
 * one Deny rule for Everyone (S-1-1-0) on Write, Delete and
 * DeleteSubdirectoriesAndFiles, inherited by every folder and file. Reads,
 * listing and running python.exe stay allowed. The root goes through the
 * environment, never into the script text, and the script goes as
 * -EncodedCommand (UTF-16LE base64), so no command-line quoting touches it.
 */
export function windowsLockCommand(root, action) {
  if (action !== "lock" && action !== "unlock") throw new Error(`windowsLockCommand: action ${action}`);
  return {
    cmd: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_LOCK_SCRIPT, "utf16le").toString("base64")],
    env: { ...process.env, TIMELY_SMOKE_ROOT: root, TIMELY_SMOKE_ACTION: action },
  };
}

function runWindowsLock(root, action) {
  const { cmd, args, env } = windowsLockCommand(root, action);
  const r = spawnSync(cmd, args, { encoding: "utf8", env });
  if (r.error) return `${cmd} could not start: ${r.error.message}`;
  return r.status === 0 ? "" : `${action} failed (exit ${r.status}): ${r.stdout}${r.stderr}`;
}

/** Make every entry under root read-only; returns a function that restores it. */
export function lockTree(root) {
  if (process.platform === "win32") {
    const failed = runWindowsLock(root, "lock");
    if (failed) {
      runWindowsLock(root, "unlock");
      throw new Error(`smoke-agent: ${failed}`);
    }
    return () => {
      const undo = runWindowsLock(root, "unlock");
      if (undo) console.error(`smoke-agent: ${undo}`);
    };
  }
  const modes = new Map([[root, lstatSync(root).mode & 0o7777]]);
  walk(root, (full, _rel, entry) => {
    if (!entry.isSymbolicLink()) modes.set(full, lstatSync(full).mode & 0o7777);
    return true;
  });
  for (const [full, mode] of modes) chmodSync(full, mode & ~0o222);
  return () => {
    for (const [full, mode] of modes) {
      try {
        chmodSync(full, mode);
      } catch (err) {
        console.error(`smoke-agent: could not restore ${full}: ${err.message}`);
      }
    }
  };
}

function step(name, fn) {
  const started = Date.now();
  fn();
  console.log(`smoke-agent: ${name} ok (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

export function smokeAgent({ root, readOnly }) {
  const python = stagedPython(root);
  for (const need of [python, path.join(root, "boot.py"), path.join(root, "app", "timely_agent", "boot.py")]) {
    if (!existsSync(need)) throw new Error(`${need} is missing: stage the runtime first (make stage-agent)`);
  }
  const scratch = path.join(scratchRoot, `smoke-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(scratch, "home"), { recursive: true });
  const env = cleanEnv(path.join(scratch, "home"));
  const before = readOnly ? snapshot(root) : null;
  const restore = readOnly ? lockTree(root) : null;
  if (readOnly) console.log(`smoke-agent: ${root} is read-only (${before.size} entries recorded)`);
  try {
    step("python -I boot.py (usage, exit 2)", () => {
      const r = spawnSync(python, ["-I", path.join(root, "boot.py")], { encoding: "utf8", cwd: scratch, env });
      if (r.status !== 2 || !r.stderr.startsWith("usage: boot.py worker")) {
        throw new Error(`python -I boot.py exited ${r.status} (want 2 and the usage line):\n${r.stdout}${r.stderr}`);
      }
    });
    step("boot.py prepare", () => {
      const r = spawnSync(python, ["-I", path.join(root, "boot.py"), "prepare", "--agent-dir", path.join(scratch, "agent")], {
        encoding: "utf8",
        cwd: scratch,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const line = r.stdout.trim().split(/\r?\n/).pop() ?? "";
      let ok = false;
      try {
        ok = JSON.parse(line).ok === true;
      } catch {
        ok = false;
      }
      if (r.status !== 0 || !ok) throw new Error(`boot.py prepare exited ${r.status}:\n${r.stdout}\n${r.stderr.split("\n").slice(-30).join("\n")}`);
    });
    step("imports through boot.py's sys.path", () => {
      const source = importCheckSource(path.join(root, "app", "timely_agent", "boot.py"));
      const r = spawnSync(python, ["-I", "-B", "-c", source], { encoding: "utf8", cwd: scratch, env });
      const line = r.stdout.trim().split(/\r?\n/).pop() ?? "";
      let failed = null;
      try {
        failed = JSON.parse(line).failed;
      } catch {
        failed = null;
      }
      if (r.status !== 0 || !failed || Object.keys(failed).length) {
        throw new Error(`the runtime cannot import what it ships (exit ${r.status}): ${JSON.stringify(failed)}\n${r.stderr}`);
      }
    });
    step("Go TestIntegrationRealWorker", () => {
      const r = spawnSync("go", ["test", "./internal/agenthost", "-run", "TestIntegrationRealWorker$", "-count=1", "-v"], {
        cwd: apiRoot,
        env: { ...process.env, TIMELY_AGENT_TEST_RUNTIME: root },
        stdio: "inherit",
      });
      if (r.error) throw new Error(`go could not start: ${r.error.message} (install Go 1.25+)`);
      if (r.status !== 0) throw new Error(`go test exited ${r.status}`);
    });
  } finally {
    restore?.();
    makeWritable(scratch); // prepare's Timely skills copy is 0555
    rmSync(scratch, { recursive: true, force: true });
  }
  if (readOnly) {
    const { created, removed, changed } = diffSnapshots(before, snapshot(root));
    const all = [...created.map((p) => `created ${p}`), ...removed.map((p) => `removed ${p}`), ...changed.map((p) => `changed ${p}`)];
    if (all.length) {
      throw new Error(`the runtime wrote into its own folder (${all.length}):\n  ${all.slice(0, 40).join("\n  ")}`);
    }
    console.log("smoke-agent: nothing inside the runtime folder was created, removed or changed");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    console.log(`smoke-agent: ${opts.root}${opts.readOnly ? " (read-only)" : ""}`);
    smokeAgent(opts);
    console.log("smoke-agent: passed");
  } catch (err) {
    console.error(`smoke-agent: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
