// The desktop sidecars must not outlive the app: lifeline, death signal,
// leftover sweep (apps/web/electron/supervisor/lifetime.ts) and the Next
// server's guard (apps/web/electron/next-guard.cjs).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApiEnv } from "../apps/web/electron/supervisor/api.ts";
import { findOrphans, parseStatParent, parseStatState, stopOrphans, withDeathSignal } from "../apps/web/electron/supervisor/lifetime.ts";
import { GUARD_FILE, WEB_HEAP_LIMIT_MB, nodeArgs } from "../apps/web/electron/supervisor/next.ts";

const guard = path.join(import.meta.dirname, "..", "apps", "web", "electron", "next-guard.cjs");

function tmpdir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "timely-lifetime-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function exited(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

// A killed process whose new parent never reaps it (a container's pid 1) is a
// zombie: dead, though kill(pid, 0) still succeeds.
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  try {
    return parseStatState(readFileSync(`/proc/${pid}/stat`, "latin1")) !== "Z";
  } catch {
    return false;
  }
}

test("withDeathSignal wraps the command in setpriv only when available", () => {
  assert.deepEqual(withDeathSignal("/opt/pg/bin/postgres", ["-D", "/data"], "INT", true), {
    command: "setpriv",
    args: ["--pdeathsig", "INT", "--", "/opt/pg/bin/postgres", "-D", "/data"],
  });
  assert.deepEqual(withDeathSignal("/opt/pg/bin/postgres", ["-D", "/data"], "INT", false), {
    command: "/opt/pg/bin/postgres",
    args: ["-D", "/data"],
  });
});

test("parseStatParent reads the parent pid past a command name with spaces and parentheses", () => {
  assert.equal(parseStatParent("4242 (next-server (v16.3.8)) S 1 4242 4242 0 -1"), 1);
  assert.equal(parseStatParent("17 (timely-api) S 900 17 17 0 -1"), 900);
  assert.equal(parseStatParent("garbage"), null);
  assert.equal(parseStatState("4242 (next-server (v16.3.8)) Z 1 4242"), "Z");
  assert.equal(parseStatState("17 (timely-api) S 900 17"), "S");
});

test("findOrphans picks out this app's API and web servers that are not its children", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const self = 500;
    const proc = (pid, ppid, env) => {
      mkdirSync(path.join(dir, String(pid)));
      writeFileSync(path.join(dir, String(pid), "environ"), `${env.join("\0")}\0`);
      writeFileSync(path.join(dir, String(pid), "stat"), `${pid} (some (name)) S ${ppid} 1 1 0`);
    };
    proc(self, 1, ["JWT_SECRET=ours"]);
    proc(600, self, ["JWT_SECRET=ours", "API_ORIGIN=http://127.0.0.1:1"]); // live child: keep
    proc(700, 1, ["JWT_SECRET=ours", "API_ORIGIN=http://127.0.0.1:1", "ELECTRON_RUN_AS_NODE=1"]); // orphan web
    proc(701, 1, ["JWT_SECRET=ours", "TIMELY_DATA_DIR=/data", "API_ORIGIN=x"]); // orphan API
    proc(702, 1, ["JWT_SECRET=theirs", "API_ORIGIN=http://127.0.0.1:1"]); // Timely Dev or another user: not ours
    proc(703, 1, ["JWT_SECRET=ours-but-longer", "API_ORIGIN=x"]); // prefix only: not ours
    proc(704, 1, ["JWT_SECRET=ours"]); // ours but neither kind: leave it
    mkdirSync(path.join(dir, "705")); // unreadable environ
    mkdirSync(path.join(dir, "self"));
    const found = findOrphans({ secret: "ours", selfPid: self, procRoot: dir }).sort((a, b) => a.pid - b.pid);
    assert.deepEqual(found, [
      { pid: 700, kind: "web" },
      { pid: 701, kind: "api" },
    ]);
    assert.deepEqual(findOrphans({ secret: "", selfPid: self, procRoot: dir }), []);
    assert.deepEqual(findOrphans({ secret: "ours", selfPid: self, procRoot: path.join(dir, "missing") }), []);
  } finally {
    cleanup();
  }
});

test("stopOrphans sends SIGTERM and SIGKILLs whatever is still running after the grace period", async () => {
  const sent = [];
  const living = new Set([10, 11]);
  await stopOrphans(
    [
      { pid: 10, kind: "web" },
      { pid: 11, kind: "api" },
      { pid: 12, kind: "web" },
    ],
    {
      graceMs: 300,
      kill: (pid, signal) => {
        if (pid === 12) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        sent.push([pid, signal]);
        if (pid === 10) living.delete(10); // 10 honours SIGTERM, 11 ignores it
      },
      isAlive: (pid) => living.has(pid),
    },
  );
  assert.deepEqual(sent, [
    [10, "SIGTERM"],
    [11, "SIGTERM"],
    [11, "SIGKILL"],
  ]);
});

test("a real orphan carrying our secret is found and stopped (Linux)", { skip: process.platform !== "linux" }, async () => {
  const secret = `test-${process.pid}-${Date.now()}`;
  // The shell starts the server in the background and exits, so it is reparented: an orphan.
  const shell = spawnSync("sh", ["-c", `"${process.execPath}" -e "setInterval(() => {}, 1000)" >/dev/null 2>&1 & echo $!`], {
    env: { ...process.env, JWT_SECRET: secret, API_ORIGIN: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  const pid = Number(shell.stdout.trim());
  assert.ok(pid > 0 && alive(pid));
  try {
    assert.deepEqual(findOrphans({ secret, selfPid: process.pid }), [{ pid, kind: "web" }]);
    await stopOrphans([{ pid, kind: "web" }], { graceMs: 3_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(alive(pid), false);
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});

test("setpriv --pdeathsig ends a child when its parent is killed (Linux with util-linux)", { skip: process.platform !== "linux" || spawnSync("setpriv", ["--pdeathsig", "TERM", "--", "true"]).status !== 0 }, async () => {
  // parent: a node process that spawns `setpriv --pdeathsig KILL -- node -e <idle>` and prints its pid.
  const parentCode = `
    const { spawn } = require("node:child_process");
    const c = spawn("setpriv", ["--pdeathsig", "KILL", "--", process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    console.log(c.pid);
    setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ["-e", parentCode], { stdio: ["ignore", "pipe", "ignore"] });
  const pid = await new Promise((resolve) => parent.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(alive(pid));
  parent.kill("SIGKILL");
  await exited(parent, 2_000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stillAlive = alive(pid);
  if (stillAlive) process.kill(pid, "SIGKILL");
  assert.equal(stillAlive, false);
});

test("next guard: the server exits when its stdin lifeline closes", async () => {
  const child = spawn(process.execPath, ["--require", guard, "-e", "setInterval(() => {}, 1000)"], {
    env: { ...process.env, TIMELY_LIFELINE: "stdin" },
    stdio: ["pipe", "ignore", "ignore"],
  });
  assert.equal(await exited(child, 300), null, "exited before the lifeline closed");
  child.stdin.end();
  assert.deepEqual(await exited(child, 3_000), { code: 0, signal: null });
});

test("next guard: without TIMELY_LIFELINE a closed stdin is ignored", async () => {
  const child = spawn(process.execPath, ["--require", guard, "-e", "setInterval(() => {}, 1000)"], {
    env: { ...process.env, TIMELY_LIFELINE: "" },
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin.end();
  const result = await exited(child, 500);
  child.kill("SIGKILL");
  assert.equal(result, null);
});

test("next guard: past the memory limit the server exits with code 75 and says why", async () => {
  const child = spawn(process.execPath, ["--require", guard, "-e", "setInterval(() => {}, 1000)"], {
    env: { ...process.env, TIMELY_WEB_RSS_LIMIT_MB: "1", TIMELY_WEB_RSS_CHECK_MS: "50" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = await exited(child, 3_000);
  if (!result) child.kill("SIGKILL");
  assert.deepEqual(result, { code: 75, signal: null });
  assert.match(stderr, /limit 1 MB/);
});

test("next guard: under the memory limit the server keeps running", async () => {
  const child = spawn(process.execPath, ["--require", guard, "-e", "setInterval(() => {}, 1000)"], {
    env: { ...process.env, TIMELY_WEB_RSS_LIMIT_MB: "4096", TIMELY_WEB_RSS_CHECK_MS: "50" },
    stdio: "ignore",
  });
  const result = await exited(child, 400);
  child.kill("SIGKILL");
  assert.equal(result, null);
});

test("Next is started with a heap cap and the guard when it was staged", () => {
  const root = path.join("res", "next-server");
  const server = path.join(root, "apps", "web", "server.js");
  assert.deepEqual(nodeArgs(root, server, () => true), [
    `--max-old-space-size=${WEB_HEAP_LIMIT_MB}`,
    "--require",
    path.join(root, GUARD_FILE),
    server,
  ]);
  assert.deepEqual(nodeArgs(root, server, () => false), [`--max-old-space-size=${WEB_HEAP_LIMIT_MB}`, server]);
});

test("the API is told to watch its stdin lifeline", () => {
  const env = buildApiEnv({
    apiPort: 1,
    bind: ["127.0.0.1"],
    postgresPort: 2,
    secrets: { dbPassword: "p", jwtSecret: "j", backupKey: "b" },
    dataDir: "/data",
    allowRegistration: false,
    shell: { PATH: "/bin", HOME: "/home/x" },
    base: {},
  });
  assert.equal(env.TIMELY_LIFELINE, "stdin");
});
