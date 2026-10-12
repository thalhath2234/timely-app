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
import { classifyProcess, findOrphans, parseStatParent, parseStatState, setprivPath, stopOrphans, withDeathSignal } from "../apps/web/electron/supervisor/lifetime.ts";
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
  assert.deepEqual(withDeathSignal("/opt/pg/bin/postgres", ["-D", "/data"], "INT", "/usr/bin/setpriv"), {
    command: "/usr/bin/setpriv",
    args: ["--pdeathsig", "INT", "--", "/opt/pg/bin/postgres", "-D", "/data"],
  });
  assert.deepEqual(withDeathSignal("/opt/pg/bin/postgres", ["-D", "/data"], "INT", null), {
    command: "/opt/pg/bin/postgres",
    args: ["-D", "/data"],
  });
});

test("setprivPath is absolute on Linux and null elsewhere", () => {
  assert.equal(setprivPath("win32"), null);
  assert.equal(setprivPath("darwin"), null);
  const found = setprivPath("linux");
  if (found !== null) assert.ok(path.isAbsolute(found));
});

test("parseStatParent reads the parent pid past a command name with spaces and parentheses", () => {
  assert.equal(parseStatParent("4242 (next-server (v16.3.8)) S 1 4242 4242 0 -1"), 1);
  assert.equal(parseStatParent("17 (timely-api) S 900 17 17 0 -1"), 900);
  assert.equal(parseStatParent("garbage"), null);
  assert.equal(parseStatState("4242 (next-server (v16.3.8)) Z 1 4242"), "Z");
  assert.equal(parseStatState("17 (timely-api) S 900 17"), "S");
});

const NEXT_ENV = ["JWT_SECRET=ours", "API_ORIGIN=http://127.0.0.1:1", "PORT=44001", "HOSTNAME=127.0.0.1", "ELECTRON_RUN_AS_NODE=1"];
const API_ENV = ["JWT_SECRET=ours", "TIMELY_DATA_DIR=/home/u/.config/Timely/data", "DB_PASSWORD=x"];
const OURS = { secret: "ours", dataDir: "/home/u/.config/Timely/data" };

test("classifyProcess needs both the program and our identity", () => {
  const next = { env: NEXT_ENV, exe: "/opt/timely-bin/timely", cwd: "/opt/timely-bin/resources/next-server", comm: "next-server (v1" };
  const api = { env: API_ENV, exe: "/opt/timely-bin/resources/api/timely-api", cwd: OURS.dataDir, comm: "timely-api" };
  assert.equal(classifyProcess(next, OURS), "web");
  assert.equal(classifyProcess(api, OURS), "api");
  // A replaced install shows "(deleted)" on the links.
  assert.equal(classifyProcess({ ...api, exe: `${api.exe} (deleted)` }, OURS), "api");
  assert.equal(classifyProcess({ ...next, exe: `${next.exe} (deleted)` }, OURS), "web");
  // Regenerated secret: the API still matches by its data folder; Next cannot be told apart, so it is left.
  assert.equal(classifyProcess({ ...api, env: ["JWT_SECRET=old"] }, OURS), "api");
  assert.equal(classifyProcess({ ...api, env: ["JWT_SECRET=old"], cwd: "/elsewhere" }, OURS), null);
  assert.equal(classifyProcess({ ...next, env: NEXT_ENV.map((e) => (e.startsWith("JWT_SECRET=") ? "JWT_SECRET=old" : e)) }, OURS), null);
  // Agent CLIs (and whatever they leave running) inherit the API's environment, secret included.
  assert.equal(classifyProcess({ env: API_ENV, exe: "/usr/bin/firefox", cwd: OURS.dataDir, comm: "firefox" }, OURS), null);
  assert.equal(classifyProcess({ env: API_ENV, exe: "/usr/bin/node", cwd: "/tmp", comm: "node" }, OURS), null);
  // Next-like processes that are not ours.
  assert.equal(classifyProcess({ ...next, env: NEXT_ENV.filter((e) => e !== "JWT_SECRET=ours") }, OURS), null);
  assert.equal(classifyProcess({ ...next, comm: "node" }, OURS), null);
  assert.equal(classifyProcess({ ...next, env: NEXT_ENV.filter((e) => !e.startsWith("ELECTRON_RUN_AS_NODE")) }, OURS), null);
  // "Timely Dev" has its own secret and data folder.
  assert.equal(classifyProcess({ ...api, env: ["JWT_SECRET=dev"], cwd: "/home/u/.config/Timely Dev/data" }, OURS), null);
});

test("findOrphans skips its own children and processes it cannot read", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const self = 500;
    const proc = (pid, ppid, env, comm) => {
      mkdirSync(path.join(dir, String(pid)));
      writeFileSync(path.join(dir, String(pid), "environ"), `${env.join("\0")}\0`);
      writeFileSync(path.join(dir, String(pid), "stat"), `${pid} (${comm}) S ${ppid} 1 1 0`);
      writeFileSync(path.join(dir, String(pid), "comm"), `${comm}\n`);
    };
    proc(self, 1, ["JWT_SECRET=ours"], "timely");
    proc(600, self, NEXT_ENV, "next-server (v1"); // live child: keep
    proc(700, 1, NEXT_ENV, "next-server (v1"); // leftover web server
    proc(702, 1, NEXT_ENV.map((e) => (e === "JWT_SECRET=ours" ? "JWT_SECRET=ours-but-longer" : e)), "next-server (v1"); // prefix only
    mkdirSync(path.join(dir, "705")); // unreadable environ
    mkdirSync(path.join(dir, "self"));
    assert.deepEqual(await findOrphans({ ...OURS, selfPid: self, procRoot: dir }), [{ pid: 700, kind: "web" }]);
    assert.deepEqual(await findOrphans({ secret: "", dataDir: "", selfPid: self, procRoot: dir }), []);
    assert.deepEqual(await findOrphans({ ...OURS, selfPid: self, procRoot: path.join(dir, "missing") }), []);
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
      killWaitMs: 100,
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

test("a real leftover web server is found and stopped (Linux)", { skip: process.platform !== "linux" }, async () => {
  const secret = `test-${process.pid}-${Date.now()}`;
  // The shell starts the "server" in the background and exits, so it is
  // reparented: a leftover. It names itself the way Next does.
  const script = "process.title = 'next-server (v16.3.8)'; setInterval(() => {}, 1000)";
  const shell = spawnSync("sh", ["-c", `"${process.execPath}" -e "${script}" >/dev/null 2>&1 & echo $!`], {
    env: { ...process.env, JWT_SECRET: secret, API_ORIGIN: "http://127.0.0.1:9", PORT: "1", ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  const pid = Number(shell.stdout.trim());
  assert.ok(pid > 0 && alive(pid));
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(await findOrphans({ secret, dataDir: "/nonexistent", selfPid: process.pid }), [{ pid, kind: "web" }]);
    await stopOrphans([{ pid, kind: "web" }], { graceMs: 3_000 });
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

test("next guard: worker threads are left alone", async () => {
  const code = `
    const { Worker } = require("node:worker_threads");
    const w = new Worker("let n = 0; const t = setInterval(() => { if (++n === 5) { clearInterval(t); require('node:worker_threads').parentPort.postMessage(n); } }, 20);", { eval: true });
    w.on("message", (n) => { console.log("ticks", n); process.exit(0); });
    w.on("exit", (c) => { console.log("worker exited", c); process.exit(1); });`;
  const child = spawn(process.execPath, ["--require", guard, "-e", code], {
    env: { ...process.env, TIMELY_LIFELINE: "stdin", TIMELY_WEB_RSS_LIMIT_MB: "4096" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  const result = await exited(child, 5_000);
  if (!result) child.kill("SIGKILL");
  assert.equal(out.trim(), "ticks 5");
});

test("next guard: a heap that stays full exits with code 75", async () => {
  // Leaks steadily. The guard is told the cap is 32 MB while V8's real cap is
  // 256 MB, so it must act on its own reading, well before V8 would abort.
  const code = "const keep = []; setInterval(() => { for (let i = 0; i < 400; i++) keep.push({ a: 'x'.repeat(64) + i }); }, 10)";
  const child = spawn(process.execPath, ["--max-old-space-size=256", "--require", guard, "-e", code], {
    env: { ...process.env, TIMELY_WEB_RSS_LIMIT_MB: "4096", TIMELY_WEB_HEAP_LIMIT_MB: "32", TIMELY_WEB_RSS_CHECK_MS: "100" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = await exited(child, 20_000);
  if (!result) child.kill("SIGKILL");
  assert.deepEqual(result, { code: 75, signal: null }, stderr);
  assert.match(stderr, /heap is full/);
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

test("next guard: past the limit it finishes the requests already running, refuses new ones, then exits", async () => {
  // /slow answers after 1.5 s; the first memory check (limit 1 MB) lands while it runs.
  const code = `
    const http = require("node:http");
    const server = http.createServer((req, res) => setTimeout(() => res.end("done"), req.url === "/slow" ? 1500 : 0));
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
  `;
  const child = spawn(process.execPath, ["--require", guard, "-e", code], {
    env: { ...process.env, TIMELY_WEB_RSS_LIMIT_MB: "1", TIMELY_WEB_RSS_CHECK_MS: "400" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = exited(child, 8_000);
  const port = await new Promise((resolve) => child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))));
  const started = Date.now();
  const slow = fetch(`http://127.0.0.1:${port}/slow`).then((response) => response.text());
  await new Promise((resolve) => setTimeout(resolve, 700));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/new`), "a new connection is refused while it drains");
  assert.equal(await slow, "done");
  const result = await exit;
  if (!result) child.kill("SIGKILL");
  assert.deepEqual(result, { code: 75, signal: null });
  assert.ok(Date.now() - started >= 1_400, "it waited for the running request");
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
