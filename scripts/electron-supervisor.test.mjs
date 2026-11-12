import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { apiBinds, buildApiEnv } from "../apps/web/electron/supervisor/api.ts";
import {
  agentAccountsDir,
  copyDataDir,
  manualBackupName,
  preUpgradeBackupName,
  pruneBackups,
  restoreDataDir,
} from "../apps/web/electron/supervisor/backup.ts";
import {
  DEFAULT_PORTS,
  LOCAL_BUILD_PORTS,
  ensureSecrets,
  loadConfig,
  makeSealer,
  plainSealer,
  saveConfig,
} from "../apps/web/electron/supervisor/config.ts";
import { checkPrivileges } from "../apps/web/electron/supervisor/guards.ts";
import { installFingerprint, isPackageManaged } from "../apps/web/electron/supervisor/install.ts";
import { ACTIONS, SETTING_KEYS, Supervisor, pairingPayload, tailscaleUrls } from "../apps/web/electron/supervisor/index.ts";
import { createElectronUpdater } from "../apps/web/electron/supervisor/updater.ts";
import { agentRuntime, resolveResourceDirs, userPaths } from "../apps/web/electron/supervisor/paths.ts";
import { findFreePort, isPortFree, listenPort, reconcilePorts } from "../apps/web/electron/supervisor/ports.ts";
import { classifyPidFile, isPostgresCommand, parsePostmasterPid, probePostgres } from "../apps/web/electron/supervisor/postgres.ts";
import { fallbackPath, lastLine } from "../apps/web/electron/supervisor/shellEnv.ts";
import { DEFAULT_BACKOFF, initialBackoff, planRestart } from "../apps/web/electron/supervisor/sidecar.ts";
import {
  expandIPv6,
  isTailscaleIPv4,
  isTailscaleIPv6,
  describeServeFailure,
  disableServe,
  enableServe,
  mergeStatus,
  scanInterfaces,
  serveOwner,
  urlFor,
} from "../apps/web/electron/supervisor/tailscale.ts";
import { FLAVOR, flavorFor } from "../apps/web/electron/flavor.ts";
import verifyPack from "../apps/web/electron/verify-pack.cjs";

function tmpdir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "timely-supervisor-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// config.json
// ---------------------------------------------------------------------------

test("flavor: release keeps Timely's name, app id and ports; local builds get their own", () => {
  const release = flavorFor(true);
  assert.equal(release.name, "Timely");
  assert.equal(release.appId, "app.timely.desktop");
  assert.deepEqual(release.ports, { ...DEFAULT_PORTS });
  const local = flavorFor(false);
  assert.equal(local.name, "Timely Dev");
  assert.equal(local.appId, "app.timely.desktop.dev");
  assert.deepEqual(local.ports, { ...LOCAL_BUILD_PORTS });
  for (const key of Object.keys(DEFAULT_PORTS)) assert.notEqual(local.ports[key], release.ports[key], key);
  // Without the build-time define (tests, plain tsc) the flavor is the local one.
  assert.equal(FLAVOR.release, false);
});

test("config: a fresh config takes the caller's default ports", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const { config } = loadConfig(path.join(dir, "config.json"), "0.1.0", LOCAL_BUILD_PORTS);
    assert.deepEqual({ postgresPort: config.postgresPort, apiPort: config.apiPort, webPort: config.webPort }, { ...LOCAL_BUILD_PORTS });
  } finally {
    cleanup();
  }
});

test("config: missing file yields defaults and is not reported as existing", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const { config, existed } = loadConfig(path.join(dir, "config.json"), "0.1.0");
    assert.equal(existed, false);
    assert.equal(config.version, "0.1.0");
    assert.deepEqual(
      { postgresPort: config.postgresPort, apiPort: config.apiPort, webPort: config.webPort },
      { ...DEFAULT_PORTS },
    );
    assert.equal(config.tailscaleEnabled, false);
    assert.equal(config.allowRegistration, false);
    assert.equal(config.setupDone, false);
    assert.deepEqual(config.secrets, {});
  } finally {
    cleanup();
  }
});

test("config: save is atomic, mode 0600, and round-trips", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const file = path.join(dir, "config.json");
    const { config } = loadConfig(file, "0.1.0");
    config.apiPort = 50123;
    config.tailscaleEnabled = true;
    config.secrets.jwtSecret = "plain:abc";
    saveConfig(file, config);
    assert.equal(existsSync(`${file}.${process.pid}.tmp`), false, "temp file is renamed away");
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    const reloaded = loadConfig(file, "9.9.9");
    assert.equal(reloaded.existed, true);
    assert.equal(reloaded.config.version, "0.1.0", "stored version wins over the fallback");
    assert.equal(reloaded.config.apiPort, 50123);
    assert.equal(reloaded.config.tailscaleEnabled, true);
    assert.deepEqual(reloaded.config.secrets, { jwtSecret: "plain:abc" });
  } finally {
    cleanup();
  }
});

test("config: malformed values fall back field by field", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ version: 3, apiPort: "nope", postgresPort: 70000, allowRegistration: false, secrets: { jwtSecret: 42, dbPassword: "plain:x" } }));
    const { config, existed } = loadConfig(file, "0.2.0");
    assert.equal(existed, true);
    assert.equal(config.version, "", "non-string version becomes empty so the upgrade path treats it as unknown");
    assert.equal(config.apiPort, DEFAULT_PORTS.apiPort);
    assert.equal(config.postgresPort, DEFAULT_PORTS.postgresPort);
    assert.equal(config.allowRegistration, false);
    assert.deepEqual(config.secrets, { dbPassword: "plain:x" });
    writeFileSync(file, "{not json");
    assert.equal(loadConfig(file, "0.2.0").existed, false);
  } finally {
    cleanup();
  }
});

test("secrets: generated once with the injected sealer and reused afterwards", () => {
  const sealed = new Map();
  const sealer = {
    seal: (plain) => {
      const token = `sealed-${sealed.size}`;
      sealed.set(token, plain);
      return token;
    },
    unseal: (token) => {
      if (!sealed.has(token)) throw new Error("bad token");
      return sealed.get(token);
    },
  };
  const { config } = loadConfig(path.join(os.tmpdir(), "does-not-exist-config.json"), "0.1.0");
  const first = ensureSecrets(config, sealer);
  assert.equal(first.changed, true);
  assert.deepEqual(first.regenerated, ["jwtSecret", "backupKey", "dbPassword"]);
  for (const value of Object.values(first.secrets)) {
    assert.match(value, /^[A-Za-z0-9_-]{43}$/, "32 random bytes as base64url");
  }
  assert.notEqual(first.secrets.jwtSecret, first.secrets.dbPassword);
  assert.equal(config.secrets.jwtSecret.startsWith("sealed-"), true);

  const second = ensureSecrets(config, sealer);
  assert.equal(second.changed, false);
  assert.deepEqual(second.secrets, first.secrets);
});

test("secrets: an unreadable sealed value is regenerated, the rest are kept", () => {
  const sealer = makeSealer({
    available: true,
    encrypt: (plain) => Buffer.from(`enc(${plain})`),
    decrypt: (buf) => {
      const text = buf.toString();
      const match = text.match(/^enc\((.*)\)$/);
      if (!match) throw new Error("cannot decrypt");
      return match[1];
    },
  });
  const { config } = loadConfig(path.join(os.tmpdir(), "does-not-exist-config.json"), "0.1.0");
  config.secrets = {
    jwtSecret: Buffer.from("enc(keep-me)").toString("base64"),
    backupKey: "plain:also-kept",
    dbPassword: Buffer.from("garbage").toString("base64"),
  };
  const result = ensureSecrets(config, sealer, () => "fresh");
  assert.equal(result.secrets.jwtSecret, "keep-me");
  assert.equal(result.secrets.backupKey, "also-kept", "plain: values are accepted even when encryption is available");
  assert.equal(result.secrets.dbPassword, "fresh");
  assert.deepEqual(result.regenerated, ["dbPassword"]);
  assert.equal(config.secrets.dbPassword, Buffer.from("enc(fresh)").toString("base64"));
  // The unreadable value is kept aside, never thrown away.
  assert.equal(config.lostSecrets?.length, 1);
  assert.equal(config.lostSecrets?.[0].key, "dbPassword");
  assert.equal(config.lostSecrets?.[0].sealed, Buffer.from("garbage").toString("base64"));
  assert.match(config.lostSecrets?.[0].lostAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  const { dir, cleanup } = tmpdir();
  try {
    const file = path.join(dir, "config.json");
    saveConfig(file, config);
    assert.equal(loadConfig(file, "0.1.0").config.lostSecrets?.[0].key, "dbPassword", "lostSecrets survive a save/load round-trip");
  } finally {
    cleanup();
  }
});

test("secrets: the plain: fallback is used when encryption is unavailable", () => {
  const sealer = makeSealer({ available: false });
  assert.equal(sealer, plainSealer);
  assert.equal(sealer.seal("x"), "plain:x");
  assert.equal(sealer.unseal("plain:x"), "x");
  assert.throws(() => sealer.unseal("AAAA"), /no decryption/);
});

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

test("ports: a free preferred port is kept, an occupied one is replaced", async () => {
  const preferred = await listenPort(0);
  assert.equal(await findFreePort(preferred), preferred);
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(preferred, "127.0.0.1", resolve));
  try {
    assert.equal(await isPortFree(preferred), false);
    const other = await findFreePort(preferred);
    assert.notEqual(other, preferred);
    assert.ok(other > 0);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("ports: reconcile keeps free ports, replaces taken ones, never hands out duplicates", async () => {
  const persisted = { postgresPort: 54329, apiPort: 48080, webPort: 44001 };
  const takenByOthers = new Set([48080]);
  let ephemeral = 60000;
  const probe = async (port) => !takenByOthers.has(port);
  const pick = async (preferred) => (preferred && !takenByOthers.has(preferred) ? preferred : ephemeral++);
  const result = await reconcilePorts(persisted, { postgresOwned: false, probe, pick });
  assert.equal(result.changed, true);
  assert.equal(result.ports.postgresPort, 54329);
  assert.equal(result.ports.apiPort, 60000);
  assert.equal(result.ports.webPort, 44001);

  const unchanged = await reconcilePorts(persisted, { postgresOwned: false, probe: async () => true, pick });
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.ports, persisted);

  // A live postmaster of ours keeps its port even though the probe says "taken".
  const owned = await reconcilePorts(persisted, { postgresOwned: true, probe: async (port) => port !== 54329, pick });
  assert.equal(owned.ports.postgresPort, 54329);
  assert.equal(owned.changed, false);

  // Two keys persisted with the same number: the second one moves.
  const dup = await reconcilePorts({ postgresPort: 1, apiPort: 1, webPort: 2 }, { postgresOwned: false, probe: async () => true, pick: async () => 7 });
  assert.deepEqual(dup.ports, { postgresPort: 1, apiPort: 7, webPort: 2 });
});

// ---------------------------------------------------------------------------
// Tailscale
// ---------------------------------------------------------------------------

test("tailscale: IPv4 CGNAT range edges (100.64.0.0/10)", () => {
  assert.equal(isTailscaleIPv4("100.64.0.0"), true);
  assert.equal(isTailscaleIPv4("100.100.1.2"), true);
  assert.equal(isTailscaleIPv4("100.127.255.255"), true);
  assert.equal(isTailscaleIPv4("100.63.255.255"), false);
  assert.equal(isTailscaleIPv4("100.128.0.0"), false);
  assert.equal(isTailscaleIPv4("101.64.0.1"), false);
  assert.equal(isTailscaleIPv4("192.168.1.1"), false);
  assert.equal(isTailscaleIPv4("100.64.0"), false);
  assert.equal(isTailscaleIPv4("100.64.0.256"), false);
  assert.equal(isTailscaleIPv4("fd7a:115c:a1e0::1"), false);
});

test("tailscale: IPv6 ULA prefix (fd7a:115c:a1e0::/48)", () => {
  assert.equal(isTailscaleIPv6("fd7a:115c:a1e0::1"), true);
  assert.equal(isTailscaleIPv6("fd7a:115c:a1e0:ab12:4843:cd96:6264:1234"), true);
  assert.equal(isTailscaleIPv6("FD7A:115C:A1E0::1"), true);
  assert.equal(isTailscaleIPv6("fd7a:115c:a1e0::1%tailscale0"), true);
  assert.equal(isTailscaleIPv6("fd7a:115c:a1e1::1"), false);
  assert.equal(isTailscaleIPv6("fd7a:115c::1"), false);
  assert.equal(isTailscaleIPv6("fe80::1"), false);
  assert.equal(isTailscaleIPv6("::1"), false);
  assert.equal(isTailscaleIPv6("100.64.0.1"), false);
  assert.equal(isTailscaleIPv6("fd7a:115c:a1e0::1::2"), false);
  assert.deepEqual(expandIPv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(expandIPv6("1:2:3:4:5:6:7"), null);
  assert.equal(expandIPv6("::ffff:1.2.3.4"), null);
});

test("tailscale: interface scan and CLI status merge", () => {
  const scan = scanInterfaces({
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    eth0: [{ family: "IPv4", address: "192.168.1.5", internal: false }],
    tailscale0: [
      { family: "IPv4", address: "100.101.102.103", internal: false },
      { family: "IPv6", address: "fd7a:115c:a1e0::1234%tailscale0", internal: false },
      { family: 6, address: "fe80::1", internal: false },
    ],
  });
  assert.deepEqual(scan, { ipv4: "100.101.102.103", ipv6: "fd7a:115c:a1e0::1234" });

  const noCli = mergeStatus(false, null, scan);
  assert.deepEqual(noCli, { installed: true, running: true, ipv4: "100.101.102.103", ipv6: "fd7a:115c:a1e0::1234" });

  const cliDown = mergeStatus(true, null, {});
  assert.deepEqual(cliDown, { installed: true, running: false });

  const cli = mergeStatus(true, { BackendState: "Running", Self: { HostName: "laptop", DNSName: "laptop.tail.ts.net.", TailscaleIPs: ["100.64.1.1", "fd7a:115c:a1e0::2"] } }, {});
  assert.deepEqual(cli, { installed: true, running: true, ipv4: "100.64.1.1", ipv6: "fd7a:115c:a1e0::2", hostname: "laptop", dnsName: "laptop.tail.ts.net" });

  const dnsOnly = mergeStatus(true, { Self: { DNSName: "laptop.tail.ts.net.", TailscaleIPs: [] } }, {});
  assert.equal(dnsOnly.hostname, "laptop.tail.ts.net");
  assert.equal(dnsOnly.running, false);

  assert.equal(urlFor("100.64.1.1", 48080), "http://100.64.1.1:48080");
  assert.equal(urlFor("fd7a:115c:a1e0::2", 48080), "http://[fd7a:115c:a1e0::2]:48080");
});

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test("backoff: doubles 1 s → 30 s, five attempts, then gives up", () => {
  let state = initialBackoff;
  const delays = [];
  for (let i = 0; i < 5; i++) {
    const plan = planRestart(state, 1000 + i);
    assert.ok(plan, `attempt ${i + 1} is allowed`);
    delays.push(plan.delayMs);
    state = plan.state;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
  assert.equal(planRestart(state, 2000), null, "sixth crash gives up");

  const capped = planRestart({ attempts: 4, healthySince: null }, 0, { ...DEFAULT_BACKOFF, maxAttempts: 10 });
  assert.equal(capped.delayMs, 16000);
  assert.equal(planRestart({ attempts: 6, healthySince: null }, 0, { ...DEFAULT_BACKOFF, maxAttempts: 10 }).delayMs, 30000, "capped at 30 s");
});

test("backoff: a minute of healthy running resets the counter", () => {
  const exhausted = { attempts: 5, healthySince: 100_000 };
  assert.equal(planRestart(exhausted, 100_000 + 59_999), null, "59.9 s healthy is not enough");
  const reset = planRestart(exhausted, 100_000 + 60_000);
  assert.ok(reset);
  assert.equal(reset.delayMs, 1000);
  assert.deepEqual(reset.state, { attempts: 1, healthySince: null });
});

// ---------------------------------------------------------------------------
// postmaster.pid
// ---------------------------------------------------------------------------

test("postmaster.pid: parse and classify with an injected liveness check", () => {
  const contents = "12345\n/home/me/.config/Timely/postgres/data\n1759490000\n54329\n/tmp/timely-pg-abc\n127.0.0.1\n  54329001         0\nready\n";
  assert.deepEqual(parsePostmasterPid(contents), { pid: 12345, dataDir: "/home/me/.config/Timely/postgres/data", port: 54329 });
  assert.equal(parsePostmasterPid(""), null);
  assert.equal(parsePostmasterPid("abc\n"), null);

  assert.deepEqual(classifyPidFile(null, () => true), { kind: "none" });
  assert.deepEqual(classifyPidFile({ pid: 12345 }, () => false), { kind: "stale", pid: 12345 });
  assert.deepEqual(classifyPidFile({ pid: 12345, port: 54329 }, (pid) => pid === 12345), { kind: "alive", pid: 12345, port: 54329 });
});

// ---------------------------------------------------------------------------
// Readiness probe (fake Postgres servers)
// ---------------------------------------------------------------------------

function fakePostgres(reply) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.end(reply);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

function errorResponse(sqlstate) {
  const body = Buffer.from(`SFATAL\0C${sqlstate}\0Mthe database system is starting up\0\0`, "latin1");
  const header = Buffer.alloc(5);
  header.write("E", 0, "latin1");
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

test("probe: auth request means ready, 57P03 means starting, no listener means down", async () => {
  const ready = await fakePostgres(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]));
  const starting = await fakePostgres(errorResponse("57P03"));
  const otherError = await fakePostgres(errorResponse("28000"));
  try {
    assert.equal(await probePostgres("127.0.0.1", ready.port), "ready");
    assert.equal(await probePostgres("127.0.0.1", starting.port), "starting");
    assert.equal(await probePostgres("127.0.0.1", otherError.port), "ready");
  } finally {
    await ready.close();
    await starting.close();
    await otherError.close();
  }
  const free = await listenPort(0);
  assert.equal(await probePostgres("127.0.0.1", free), "down");
});

// ---------------------------------------------------------------------------
// Pairing payload and API environment
// ---------------------------------------------------------------------------

test("pairing: Tailscale URLs first (v4 then v6), loopback last; empty when disabled", () => {
  const ts = { ipv4: "100.64.1.1", ipv6: "fd7a:115c:a1e0::2" };
  assert.deepEqual(pairingPayload({ name: "laptop", apiPort: 48080, tailscaleEnabled: true, tailscale: ts }), {
    v: 1,
    name: "laptop",
    urls: ["http://100.64.1.1:48080", "http://[fd7a:115c:a1e0::2]:48080", "http://127.0.0.1:48080"],
  });
  assert.deepEqual(pairingPayload({ name: "laptop", apiPort: 48080, tailscaleEnabled: false, tailscale: ts }).urls, ["http://127.0.0.1:48080"]);
  assert.deepEqual(
    pairingPayload({ name: "laptop", id: "inst-1", apiPort: 48080, tailscaleEnabled: true, tailscale: ts, httpsUrl: "https://laptop.tail.ts.net" }),
    {
      v: 1,
      name: "laptop",
      id: "inst-1",
      urls: ["https://laptop.tail.ts.net", "http://100.64.1.1:48080", "http://[fd7a:115c:a1e0::2]:48080", "http://127.0.0.1:48080"],
    },
  );
  assert.deepEqual(tailscaleUrls({ apiPort: 1, tailscaleEnabled: true, tailscale: {} }), []);
  assert.deepEqual(tailscaleUrls({ apiPort: 1, tailscaleEnabled: true, tailscale: { ipv6: "fd7a:115c:a1e0::9" } }), ["http://[fd7a:115c:a1e0::9]:1"]);
});

test("api env: contract variables, binds, and no Electron leakage", () => {
  const secrets = { jwtSecret: "jwt", backupKey: "bk", dbPassword: "pw" };
  assert.deepEqual(apiBinds(true, { ipv4: "100.64.1.1", ipv6: "fd7a:115c:a1e0::2" }), ["127.0.0.1", "100.64.1.1", "fd7a:115c:a1e0::2"]);
  assert.deepEqual(apiBinds(false, { ipv4: "100.64.1.1" }), ["127.0.0.1"]);
  assert.deepEqual(apiBinds(true, {}), ["127.0.0.1"]);
  const env = buildApiEnv({
    apiPort: 48080,
    bind: ["127.0.0.1", "100.64.1.1"],
    postgresPort: 54329,
    secrets,
    dataDir: "/data",
    allowRegistration: false,
    shell: { PATH: "/login/bin", HOME: "/home/me" },
    base: { ELECTRON_RUN_AS_NODE: "1", DB_HOST: "leak", API_PORT: "8080", LANG: "C.UTF-8", PATH: "/old" },
  });
  assert.equal(env.API_PORT, "48080");
  assert.equal(env.API_BIND, "127.0.0.1,100.64.1.1");
  assert.equal(env.DB_HOST, "127.0.0.1");
  assert.equal(env.DB_PORT, "54329");
  assert.equal(env.DB_USER, "timely");
  assert.equal(env.DB_PASSWORD, "pw");
  assert.equal(env.DB_NAME, "timely");
  assert.equal(env.DB_SSLMODE, "disable");
  assert.equal(env.JWT_SECRET, "jwt");
  assert.equal(env.TIMELY_BACKUP_KEY, "bk");
  assert.equal(env.TIMELY_DATA_DIR, "/data");
  assert.equal(env.ALLOW_REGISTRATION, "false");
  assert.equal(env.PATH, "/login/bin");
  assert.equal(env.HOME, "/home/me");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
});

test("api env: the agent runtime is passed through, and an inherited one never leaks", () => {
  const input = {
    apiPort: 48090,
    bind: ["127.0.0.1"],
    postgresPort: 54339,
    secrets: { jwtSecret: "jwt", backupKey: "bk", dbPassword: "pw" },
    dataDir: "/data",
    allowRegistration: false,
    shell: { PATH: "/login/bin", HOME: "/home/me" },
    base: { TIMELY_AGENT_RUNTIME: "/home/me/dev/apps/agent", TIMELY_AGENT_PYTHON: "/kept" },
  };
  const bundled = buildApiEnv({ ...input, agentRuntime: "/opt/Timely/resources/agent" });
  assert.equal(bundled.TIMELY_AGENT_RUNTIME, "/opt/Timely/resources/agent", "the bundled runtime replaces the developer shell's");
  const none = buildApiEnv(input);
  assert.equal("TIMELY_AGENT_RUNTIME" in none, false, "no bundled runtime: the inherited value is dropped");
  assert.equal(none.TIMELY_AGENT_PYTHON, "/kept", "other TIMELY_* values still pass through");
});

test("api env: the supervisor hands the API resources/agent only when it holds boot.py, and logs it at boot", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const sup = makeSupervisor(dir, undefined);
    sup.secrets = { jwtSecret: "jwt", backupKey: "bk", dbPassword: "pw" };
    const shell = { PATH: "/bin", HOME: dir };
    assert.equal(sup.apiEnv(shell).TIMELY_AGENT_RUNTIME, undefined, "no runtime staged");
    const agent = path.join(dir, "res-agent");
    mkdirSync(agent, { recursive: true });
    writeFileSync(path.join(agent, "boot.py"), "");
    assert.equal(sup.apiEnv(shell).TIMELY_AGENT_RUNTIME, agent);

    // No Postgres binaries here: boot fails at the database step, after the resources line.
    await assert.rejects(sup.boot(), (error) => error.step === "postgres");
    sup.log.close();
    const logDir = userPaths(dir).logDir;
    const text = readdirSync(logDir).map((name) => readFileSync(path.join(logDir, name), "utf8")).join("");
    const line = text.split("\n").find((l) => l.includes("boot: resources "));
    assert.ok(line?.endsWith(` agent=${agent}`), `boot line names the runtime: ${line}`);
  } finally {
    cleanup();
  }
});

test("api env: a packaged supervisor sets TIMELY_AGENT_RUNTIME even when resources/agent has no boot.py", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const sup = makeSupervisor(dir, undefined, { packaged: true });
    sup.secrets = { jwtSecret: "jwt", backupKey: "bk", dbPassword: "pw" };
    const agent = path.join(dir, "res-agent");
    assert.equal(sup.apiEnv({ PATH: "/bin", HOME: dir }).TIMELY_AGENT_RUNTIME, agent);
    await assert.rejects(sup.boot(), (error) => error.step === "postgres");
    sup.log.close();
    const logDir = userPaths(dir).logDir;
    const text = readdirSync(logDir).map((name) => readFileSync(path.join(logDir, name), "utf8")).join("");
    const line = text.split("\n").find((l) => l.includes("boot: resources "));
    assert.ok(line?.endsWith(` agent=${agent} (no boot.py: the agent engine is unavailable)`), `boot line: ${line}`);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Backups, paths, shell env, guards
// ---------------------------------------------------------------------------

test("backup: folder names and pruning keep the newest three", () => {
  const when = new Date("2026-10-03T10:11:12.345Z");
  assert.equal(preUpgradeBackupName("0.1.0", "0.2.0", when), "pre-upgrade-0.1.0-0.2.0-2026-10-03_10-11-12-345");
  assert.equal(preUpgradeBackupName("", "0.2.0", when).startsWith("pre-upgrade-unknown-0.2.0-"), true);
  assert.equal(manualBackupName(when), "manual-2026-10-03_10-11-12-345");

  const { dir, cleanup } = tmpdir();
  try {
    const names = ["a", "b", "c", "d", "e"].map((n) => `pre-upgrade-${n}`);
    names.forEach((name, i) => {
      const folder = path.join(dir, name);
      mkdirSync(folder);
      writeFileSync(path.join(folder, "PG_VERSION"), "17");
      const t = new Date(2026, 0, 1 + i);
      utimesSync(folder, t, t);
    });
    writeFileSync(path.join(dir, "manual-x"), "keep");
    const removed = pruneBackups(dir, "pre-upgrade-", 3);
    assert.deepEqual(removed.sort(), ["pre-upgrade-a", "pre-upgrade-b"]);
    assert.equal(existsSync(path.join(dir, "pre-upgrade-e", "PG_VERSION")), true);
    assert.equal(existsSync(path.join(dir, "manual-x")), true);
    assert.deepEqual(pruneBackups(path.join(dir, "missing"), "pre-upgrade-", 3), []);
  } finally {
    cleanup();
  }
});

test("backup: copies a stopped data directory without the pid file and refuses a running one", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const pgData = path.join(dir, "data");
    mkdirSync(path.join(pgData, "base", "1"), { recursive: true });
    writeFileSync(path.join(pgData, "PG_VERSION"), "17");
    writeFileSync(path.join(pgData, "base", "1", "123"), "rows");
    writeFileSync(path.join(pgData, "postmaster.opts"), "opts");
    const backupDir = path.join(dir, "backups");
    const target = copyDataDir({ pgData, backupDir, name: "manual-test" });
    assert.equal(target, path.join(backupDir, "manual-test"));
    assert.equal(readFileSync(path.join(target, "base", "1", "123"), "utf8"), "rows");
    assert.equal(existsSync(path.join(target, "postmaster.opts")), false);
    assert.equal(existsSync(`${target}.partial`), false);

    writeFileSync(path.join(pgData, "postmaster.pid"), "123\n");
    assert.throws(() => copyDataDir({ pgData, backupDir, name: "manual-running" }), /still running/);
    assert.throws(() => copyDataDir({ pgData: path.join(dir, "nope"), backupDir, name: "x" }), /No database/);
  } finally {
    cleanup();
  }
});

// An agent home as the API leaves it: what the agent learned and the chat
// sessions, plus config, secrets, sign-ins and a workspace a backup leaves out.
function plantAgentHome(accounts, dir, marker) {
  const home = path.join(accounts, dir);
  const files = {
    "memories/USER.md": `About you ${marker}`,
    "skills/learned/pantry-steps/SKILL.md": `skill ${marker}`,
    "pending/memory/c0ffee01.json": `{"id": "c0ffee01", "marker": "${marker}"}`,
    "sessions/s1.json": `session ${marker}`,
    ".timely/counters.json": `{"marker": "${marker}"}`,
    "state.db": `db ${marker}`,
    "state.db-wal": `wal ${marker}`,
    ".curator_backups/blobs/abc123": `blob ${marker}`,
    ".curator_backups/2026-11-11/skills.tar.gz": "a curator snapshot",
    "config.yaml": "model: x",
    "SOUL.md": "soul",
    ".env": "OPENAI_API_KEY=sk-planted",
    "mcp-tokens/server.json": "{}",
    "workspace/notes.txt": "notes",
    "home/.bashrc": "rc",
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    writeFileSync(path.join(home, rel), content);
  }
  return home;
}

// The skill ledger's blobs come along: Undo and "what changed" of a learned
// skill read them (Hermes refuses a rollback whose blob is missing).
// sessions/ (Hermes' request dumps: a failed request's whole body) stays out
// (review round 8): a deleted chat's dump must not ride into every backup.
const KEPT = ["memories/USER.md", "skills/learned/pantry-steps/SKILL.md", "pending/memory/c0ffee01.json", ".timely/counters.json", "state.db", "state.db-wal", ".curator_backups/blobs/abc123"];
const LEFT_OUT = ["config.yaml", "SOUL.md", ".env", "mcp-tokens", "workspace", "home", "sessions", ".curator_backups/2026-11-11"];

function stoppedDatabase(dir, rows) {
  const pgData = path.join(dir, "postgres", "data");
  mkdirSync(path.join(pgData, "base", "1"), { recursive: true });
  writeFileSync(path.join(pgData, "PG_VERSION"), "17");
  writeFileSync(path.join(pgData, "base", "1", "123"), rows);
  return pgData;
}

test("backup: copies the agent homes beside the database folder, only what the agent learned and the sessions", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const pgData = stoppedDatabase(dir, "rows");
    const accounts = agentAccountsDir(path.join(dir, "data"));
    assert.equal(accounts, path.join(dir, "data", "agent", "accounts"));
    const a = "account-" + "a".repeat(24);
    plantAgentHome(accounts, a, "one");
    // Staged restores and anything that is not an account home stay out,
    // and a symlink in a home is never followed.
    mkdirSync(path.join(accounts, `.restore-${a}-20261111T120000Z-abcdef`, "memories"), { recursive: true });
    writeFileSync(path.join(dir, "outside.txt"), "outside");
    symlinkSync(path.join(dir, "outside.txt"), path.join(accounts, a, "memories", "link.md"));
    const backupDir = path.join(dir, "backups");

    const target = copyDataDir({ pgData, backupDir, name: "manual-agent", agentAccounts: accounts });
    const agent = `${target}.agent`;
    assert.deepEqual(readdirSync(agent), [a]);
    for (const rel of KEPT) assert.equal(existsSync(path.join(agent, a, rel)), true, `${rel} is in the backup`);
    for (const rel of LEFT_OUT) assert.equal(existsSync(path.join(agent, a, rel)), false, `${rel} is not in the backup`);
    assert.equal(existsSync(path.join(agent, a, "memories", "link.md")), false, "a symlink is not followed");
    assert.equal(existsSync(`${agent}.partial`), false);
    assert.equal(readFileSync(path.join(target, "base", "1", "123"), "utf8"), "rows");

    // Without an agent folder (no agent used yet) only the database is copied.
    const plain = copyDataDir({ pgData, backupDir, name: "manual-plain", agentAccounts: path.join(dir, "none") });
    assert.equal(existsSync(`${plain}.agent`), false);

    // Pruning counts a backup once and takes its agent homes with it.
    for (const name of ["pre-upgrade-a", "pre-upgrade-b"]) {
      const t = copyDataDir({ pgData, backupDir, name, agentAccounts: accounts });
      const when = new Date(name.endsWith("a") ? 2026 : 2027, 0, 1);
      utimesSync(t, when, when);
      utimesSync(`${t}.agent`, when, when);
    }
    assert.deepEqual(pruneBackups(backupDir, "pre-upgrade-", 1), ["pre-upgrade-a"]);
    assert.equal(existsSync(path.join(backupDir, "pre-upgrade-a.agent")), false);
    assert.equal(existsSync(path.join(backupDir, "pre-upgrade-b.agent")), true);
  } finally {
    cleanup();
  }
});

test("backup: a home with read-only skill folders backs up, prunes and restores (a read-only install)", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const { dir, cleanup } = tmpdir();
  const lock = (root) => {
    for (const name of readdirSync(root, { recursive: true })) {
      const p = path.join(root, name);
      if (statSync(p).isFile()) chmodSync(p, 0o444);
    }
    for (const name of readdirSync(root, { recursive: true }).reverse()) {
      const p = path.join(root, name);
      if (statSync(p).isDirectory()) chmodSync(p, 0o555);
    }
    chmodSync(root, 0o555);
  };
  try {
    const pgData = stoppedDatabase(dir, "rows");
    const accounts = agentAccountsDir(path.join(dir, "data"));
    const a = "account-" + "a".repeat(24);
    plantAgentHome(accounts, a, "one");
    // A skill seeded from a read-only install folder keeps its modes.
    const seeded = path.join(accounts, a, "skills", "media", "youtube-content");
    mkdirSync(seeded, { recursive: true });
    writeFileSync(path.join(seeded, "SKILL.md"), "seeded");
    lock(path.join(accounts, a, "skills", "media"));
    const backupDir = path.join(dir, "backups");

    const target = copyDataDir({ pgData, backupDir, name: "manual-ro", agentAccounts: accounts });
    assert.equal(readFileSync(path.join(`${target}.agent`, a, "skills", "media", "youtube-content", "SKILL.md"), "utf8"), "seeded");
    assert.equal(existsSync(`${target}.agent.partial`), false, "no partial copy is left behind");
    assert.equal(existsSync(`${target}.partial`), false);
    // A second backup of the same name replaces the first.
    copyDataDir({ pgData, backupDir, name: "manual-ro", agentAccounts: accounts });

    // Restoring replaces the live home's read-only folders.
    restoreDataDir({ pgData, backupDir, name: "manual-ro", agentAccounts: accounts });
    assert.equal(readFileSync(path.join(accounts, a, "skills", "media", "youtube-content", "SKILL.md"), "utf8"), "seeded");

    // An older backup that still holds read-only folders prunes.
    lock(path.join(`${target}.agent`, a, "skills", "media"));
    const later = copyDataDir({ pgData, backupDir, name: "manual-ro-later", agentAccounts: accounts });
    const when = new Date(2027, 0, 1);
    utimesSync(later, when, when);
    utimesSync(target, new Date(2026, 0, 1), new Date(2026, 0, 1));
    assert.deepEqual(pruneBackups(backupDir, "manual-ro", 1), ["manual-ro"]);
    assert.equal(existsSync(`${target}.agent`), false);
  } finally {
    for (const root of [path.join(dir, "data"), path.join(dir, "backups")]) {
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root, { recursive: true })) {
        const p = path.join(root, name);
        try {
          if (statSync(p).isDirectory()) chmodSync(p, 0o755);
        } catch {}
      }
    }
    cleanup();
  }
});

test("backup: restoring a folder backup puts the database and the agent homes back together", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const pgData = stoppedDatabase(dir, "rows at backup");
    const accounts = agentAccountsDir(path.join(dir, "data"));
    const a = "account-" + "a".repeat(24);
    const b = "account-" + "b".repeat(24);
    plantAgentHome(accounts, a, "at backup");
    const backupDir = path.join(dir, "backups");
    copyDataDir({ pgData, backupDir, name: "manual-1", agentAccounts: accounts });

    // After the backup: rows change, the agent learns more, a new account
    // starts using the agent.
    writeFileSync(path.join(pgData, "base", "1", "123"), "rows later");
    writeFileSync(path.join(accounts, a, "memories", "USER.md"), "About you later");
    mkdirSync(path.join(accounts, a, "skills", "learned", "later-skill"), { recursive: true });
    writeFileSync(path.join(accounts, a, "skills", "learned", "later-skill", "SKILL.md"), "later");
    plantAgentHome(accounts, b, "new account");

    writeFileSync(path.join(pgData, "postmaster.pid"), "123\n");
    assert.throws(() => restoreDataDir({ pgData, backupDir, name: "manual-1", agentAccounts: accounts }), /still running/);
    rmSync(path.join(pgData, "postmaster.pid"));
    assert.throws(() => restoreDataDir({ pgData, backupDir, name: "missing", agentAccounts: accounts }), /No database backup/);

    const result = restoreDataDir({ pgData, backupDir, name: "manual-1", agentAccounts: accounts });
    assert.deepEqual(result, { source: path.join(backupDir, "manual-1"), agentHomes: 2 });
    assert.equal(readFileSync(path.join(pgData, "base", "1", "123"), "utf8"), "rows at backup");
    assert.equal(existsSync(`${pgData}.restoring`) || existsSync(`${pgData}.replaced`), false);
    assert.equal(readFileSync(path.join(accounts, a, "memories", "USER.md"), "utf8"), "About you at backup");
    assert.equal(existsSync(path.join(accounts, a, "skills", "learned", "later-skill")), false, "learned after the backup is gone");
    for (const rel of KEPT) assert.equal(existsSync(path.join(accounts, a, rel)), true, `${rel} came back`);
    // The home keeps what a backup never carries: config, sign-ins, workspace.
    for (const rel of LEFT_OUT) assert.equal(existsSync(path.join(accounts, a, rel)), true, `${rel} stayed`);
    // An account the backup has no agent state for loses what it learned since.
    for (const rel of KEPT) assert.equal(existsSync(path.join(accounts, b, rel)), false, `${rel} of the newer account is gone`);
    assert.equal(existsSync(path.join(accounts, b, "config.yaml")), true);

    // A backup from before agent homes were copied restores the database only.
    rmSync(path.join(backupDir, "manual-1.agent"), { recursive: true });
    writeFileSync(path.join(accounts, a, "memories", "USER.md"), "kept as is");
    assert.deepEqual(restoreDataDir({ pgData, backupDir, name: "manual-1", agentAccounts: accounts }).agentHomes, null);
    assert.equal(readFileSync(path.join(accounts, a, "memories", "USER.md"), "utf8"), "kept as is");
  } finally {
    cleanup();
  }
});

test("paths: resource resolution for packaged, override and staged dev layouts", () => {
  const packaged = resolveResourceDirs({ isPackaged: true, resourcesPath: "/opt/Timely/resources", appPath: "/opt/Timely/resources/app.asar", platform: "linux", arch: "x64", env: {} });
  assert.deepEqual(packaged, {
    api: "/opt/Timely/resources/api",
    postgres: "/opt/Timely/resources/postgres",
    next: "/opt/Timely/resources/next-server",
    agent: "/opt/Timely/resources/agent",
  });

  const staged = resolveResourceDirs({ isPackaged: false, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "darwin", arch: "arm64", env: {} });
  assert.deepEqual(staged, {
    api: "/repo/apps/web/.electron-api/mac-arm64",
    postgres: "/repo/apps/web/.electron-postgres/mac-arm64",
    next: "/repo/apps/web/.electron-next",
    agent: "/repo/apps/web/.electron-agent/mac-arm64",
  });
  const stagedWin = resolveResourceDirs({ isPackaged: false, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "win32", arch: "x64", env: {} });
  assert.equal(stagedWin.agent, path.join("/repo/apps/web", ".electron-agent", "win-x64"), "stage dirs use electron-builder's ${os} names");

  const override = resolveResourceDirs({ isPackaged: true, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "linux", arch: "x64", env: { TIMELY_RESOURCES_DIR: "/tmp/res" } });
  assert.equal(override.api, "/tmp/res/api");
  assert.equal(override.postgres, "/tmp/res/postgres");
  assert.equal(override.next, "/repo/apps/web/.electron-next", "falls back to the staged Next output when the override has none");
  assert.equal(override.agent, "/repo/apps/web/.electron-agent/linux-x64", "falls back to the staged agent runtime when the override has none");

  const paths = userPaths("/home/me/.config/Timely");
  assert.equal(paths.configFile, "/home/me/.config/Timely/config.json");
  assert.equal(paths.pgData, "/home/me/.config/Timely/postgres/data");
  assert.equal(paths.dataDir, "/home/me/.config/Timely/data");
  assert.equal(paths.backupDir, "/home/me/.config/Timely/backups");
  assert.equal(paths.logDir, "/home/me/.config/Timely/logs");
});

test("paths: an override folder holding agent/ wins over the staged runtime", () => {
  const { dir, cleanup } = tmpdir();
  try {
    mkdirSync(path.join(dir, "agent"));
    const override = resolveResourceDirs({ isPackaged: false, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "linux", arch: "x64", env: { TIMELY_RESOURCES_DIR: dir } });
    assert.equal(override.agent, path.join(dir, "agent"));
  } finally {
    cleanup();
  }
});

test("paths: the agent runtime is handed over only when boot.py is there", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const agent = path.join(dir, "agent");
    mkdirSync(path.join(agent, "python"), { recursive: true });
    assert.equal(agentRuntime(agent), undefined, "a folder without boot.py is not a runtime");
    assert.equal(agentRuntime(path.join(dir, "missing")), undefined);
    writeFileSync(path.join(agent, "boot.py"), "");
    assert.equal(agentRuntime(agent), agent);
  } finally {
    cleanup();
  }
});

test("paths: a packaged app hands over resources/agent even without boot.py, so the API never searches above its data folder", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const agent = path.join(dir, "resources", "agent");
    assert.equal(agentRuntime(agent, { packaged: true }), agent, "missing folder");
    mkdirSync(agent, { recursive: true });
    assert.equal(agentRuntime(agent, { packaged: true }), agent, "folder without boot.py");
    assert.equal(agentRuntime(agent, { packaged: false }), undefined, "unpackaged runs keep the dev discovery");
  } finally {
    cleanup();
  }
});

test("main.ts builds the Supervisor with packaged: app.isPackaged, and SupervisorDeps makes it required", () => {
  // 024aecc9's fix lives in that one line; with `packaged` optional, deleting it still typechecked.
  const electron = path.join(import.meta.dirname, "..", "apps", "web", "electron");
  const main = readFileSync(path.join(electron, "main.ts"), "utf8");
  const call = main.slice(main.indexOf("new Supervisor({"), main.indexOf("});", main.indexOf("new Supervisor({")));
  assert.match(call, /\n\s+packaged: app\.isPackaged,\n/);
  const deps = readFileSync(path.join(electron, "supervisor", "index.ts"), "utf8");
  assert.match(deps, /export type SupervisorDeps = \{[\s\S]*?\n {2}packaged: boolean;\n/);
});

// A small staged agent tree: files, a relative interpreter link, an empty folder.
function stageAgentFixture(root) {
  mkdirSync(path.join(root, "python", "bin"), { recursive: true });
  mkdirSync(path.join(root, "app", "skills"), { recursive: true });
  mkdirSync(path.join(root, "app", "timely_agent"), { recursive: true });
  writeFileSync(path.join(root, "boot.py"), "import sys\n");
  writeFileSync(path.join(root, "python", "bin", "python3.14"), "ELF....");
  symlinkSync("python3.14", path.join(root, "python", "bin", "python3"));
  writeFileSync(path.join(root, "app", "timely_agent", "boot.py"), "pass\n");
  const { files, links } = verifyPack.listAgentTree(root);
  const manifest = { target: "linux-x64", files, links, totals: { files: files.length, bytes: 0 } };
  writeFileSync(path.join(root, "MANIFEST.json"), JSON.stringify(manifest));
  return manifest;
}

test("verify-pack: a packed agent folder identical to the stage passes", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const root = path.join(dir, "agent");
    const manifest = stageAgentFixture(root);
    assert.ok(manifest.files.some(([rel]) => rel === "python/bin/python3.14"));
    assert.equal(manifest.files.some(([rel]) => rel === "MANIFEST.json"), false);
    assert.deepEqual(verifyPack.verifyAgentTree(root, manifest), []);
    // electron-builder drops empty folders on Linux; the runtime does not need them.
    rmSync(path.join(root, "app", "skills"), { recursive: true });
    assert.deepEqual(verifyPack.verifyAgentTree(root, manifest), []);
  } finally {
    cleanup();
  }
});

test("verify-pack: dropped, resized, extra and absolute-linked entries and a missing manifest are each reported", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const root = path.join(dir, "agent");
    const manifest = stageAgentFixture(root);
    rmSync(path.join(root, "app", "timely_agent", "boot.py"));
    writeFileSync(path.join(root, "boot.py"), "import sys  # longer\n");
    writeFileSync(path.join(root, "extra.txt"), "x");
    rmSync(path.join(root, "python", "bin", "python3"));
    symlinkSync(path.join(root, "python", "bin", "python3.14"), path.join(root, "python", "bin", "python3"));
    rmSync(path.join(root, "MANIFEST.json"));
    const problems = verifyPack.verifyAgentTree(root, manifest);
    const has = (prefix, rel) => assert.ok(problems.some((p) => p.startsWith(prefix) && p.includes(rel)), `${prefix} ${rel} in ${JSON.stringify(problems)}`);
    has("missing:", "app/timely_agent/boot.py");
    has("size differs:", "boot.py");
    has("not in the stage:", "extra.txt");
    has("absolute symlink:", "python/bin/python3");
    has("symlink differs:", "python/bin/python3");
    has("missing:", "MANIFEST.json");
    assert.equal(problems.length, 6);

    assert.deepEqual(verifyPack.verifyAgentTree(path.join(dir, "nowhere"), manifest), [`the packed app has no agent runtime at ${path.join(dir, "nowhere")}`]);
  } finally {
    cleanup();
  }
});

// A minimal PE32+ image: MZ header, PE signature, COFF header, an optional
// header with 16 data directories, then `body` bytes.
function peImage(bodyLength, fill = 0x5a) {
  const buf = Buffer.alloc(0x188 + bodyLength, fill);
  buf.fill(0, 0, 0x188);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x20b, 0x98);
  buf.writeUInt32LE(16, 0x98 + 108);
  return buf;
}

// What signtool does to it: pad to 8 bytes, append a WIN_CERTIFICATE table,
// point the security directory at it and rewrite the header checksum.
function authenticodeSign(image, certLength = 9000) {
  const padded = Buffer.concat([image, Buffer.alloc((8 - (image.length % 8)) % 8)]);
  const cert = Buffer.alloc(certLength, 0x30);
  const signed = Buffer.concat([padded, cert]);
  const security = 0x98 + 112 + 4 * 8;
  signed.writeUInt32LE(padded.length, security);
  signed.writeUInt32LE(cert.length, security + 4);
  signed.writeUInt32LE(0x1234abcd, 0x98 + 64);
  return signed;
}

test("verify-pack: a Windows .exe signed while packing passes on win32 only, and only as the staged image plus a certificate", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const stage = path.join(dir, "stage");
    const packed = path.join(dir, "packed");
    const exes = ["python/python.exe", "app/site-packages/winpty/winpty-agent.exe"];
    const write = (root, rel, data) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), data);
    };
    for (const root of [stage, packed]) {
      write(root, "boot.py", "import sys\n");
      write(root, "python/python314.dll", peImage(4001));
      write(root, exes[0], peImage(5003));
      write(root, exes[1], peImage(2048, 0x11));
    }
    const { files, links } = verifyPack.listAgentTree(stage);
    const manifest = { target: "win32-x64", files, links, totals: { files: files.length, bytes: 0 } };
    writeFileSync(path.join(packed, "MANIFEST.json"), JSON.stringify(manifest));
    for (const rel of exes) writeFileSync(path.join(packed, rel), authenticodeSign(readFileSync(path.join(stage, rel))));

    const win = { platform: "win32", stagedDir: stage };
    assert.deepEqual(verifyPack.verifyAgentTree(packed, manifest, win), [], "signed executables are the staged ones");
    // Re-signing a signed staged file replaces its certificate table.
    write(stage, exes[1], authenticodeSign(peImage(2048, 0x11), 3000));
    assert.deepEqual(verifyPack.verifyAgentTree(packed, { ...manifest, files: verifyPack.listAgentTree(stage).files }, win), []);
    write(stage, exes[1], peImage(2048, 0x11));

    const sizeDiffers = (problems) => problems.filter((p) => p.startsWith("size differs:")).map((p) => p.split(" ")[2]).sort();
    assert.deepEqual(sizeDiffers(verifyPack.verifyAgentTree(packed, manifest, { platform: "linux", stagedDir: stage })), [...exes].sort(), "only win32 signs while packing");
    assert.deepEqual(sizeDiffers(verifyPack.verifyAgentTree(packed, manifest)), [...exes].sort());

    // A changed byte before the certificate is a different program.
    const tampered = authenticodeSign(readFileSync(path.join(stage, exes[0])));
    tampered[0x200] ^= 0xff;
    writeFileSync(path.join(packed, exes[0]), tampered);
    assert.deepEqual(sizeDiffers(verifyPack.verifyAgentTree(packed, manifest, win)), [exes[0]]);
    // Bytes appended without a certificate table are not a signature.
    writeFileSync(path.join(packed, exes[0]), Buffer.concat([readFileSync(path.join(stage, exes[0])), Buffer.alloc(64, 1)]));
    assert.deepEqual(sizeDiffers(verifyPack.verifyAgentTree(packed, manifest, win)), [exes[0]]);
    writeFileSync(path.join(packed, exes[0]), authenticodeSign(readFileSync(path.join(stage, exes[0]))));
    // Only .exe files are signed by default (no win.signExts), so a grown .dll fails.
    writeFileSync(path.join(packed, "python/python314.dll"), authenticodeSign(peImage(4001)));
    assert.deepEqual(sizeDiffers(verifyPack.verifyAgentTree(packed, manifest, win)), ["python/python314.dll"]);
  } finally {
    cleanup();
  }
});

test("verify-pack: afterPack refuses a target with no staged runtime (every installer ships the agent)", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    // linux-universal is never staged.
    await assert.rejects(
      verifyPack({ appOutDir: dir, electronPlatformName: "linux", arch: 4, packager: {} }),
      /no staged agent runtime for linux-universal/,
    );
  } finally {
    cleanup();
  }
});

test("shell env: fallback PATH gains the usual user directories once; last line wins", () => {
  const result = fallbackPath("/usr/bin:/usr/local/bin", "/home/me", "linux");
  assert.equal(result, "/usr/bin:/usr/local/bin:/opt/homebrew/bin:/home/me/.local/bin");
  assert.equal(fallbackPath("C:\\Windows", "C:\\Users\\me", "win32"), "C:\\Windows");
  assert.equal(lastLine("Welcome!\n\n/usr/local/bin:/usr/bin\n"), "/usr/local/bin:/usr/bin");
  assert.equal(lastLine(""), "");
});

test("guards: root on linux and elevation on windows are refused", () => {
  assert.deepEqual(checkPrivileges({ platform: "linux", getuid: () => 1000 }), { ok: true });
  assert.equal(checkPrivileges({ platform: "linux", getuid: () => 0 }).ok, false);
  assert.equal(checkPrivileges({ platform: "darwin", getuid: () => 0 }).ok, false);
  assert.deepEqual(checkPrivileges({ platform: "win32", elevated: () => false }), { ok: true });
  const refused = checkPrivileges({ platform: "win32", elevated: () => true });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Administrator/);
});

test("config file is readable only by the owner after save", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const file = path.join(dir, "config.json");
    const { config } = loadConfig(file, "0.1.0");
    saveConfig(file, config);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).version, "0.1.0");
  } finally {
    cleanup();
  }
});

test("only a postgres command counts as the orphaned postmaster", () => {
  for (const comm of ["postgres\n", "/opt/Timely/resources/postgres/bin/postgres", "postmaster"]) {
    assert.equal(isPostgresCommand(comm), true, comm);
  }
  for (const comm of ["", "bash", "firefox", "/usr/bin/postgres-exporter"]) {
    assert.equal(isPostgresCommand(comm), false, comm);
  }
});

test("install fingerprint changes when a package upgrade swaps the files", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const exec = path.join(dir, "Timely");
    const nextRoot = path.join(dir, "resources", "next-server");
    const web = path.join(nextRoot, "apps", "web");
    mkdirSync(path.join(web, ".next"), { recursive: true });
    writeFileSync(path.join(web, "server.js"), "");
    writeFileSync(path.join(web, ".next", "BUILD_ID"), "build-a\n");
    writeFileSync(exec, "old");
    const before = installFingerprint({ execPath: exec, nextRoot });
    assert.match(before, /^build-a\|/);
    assert.equal(installFingerprint({ execPath: exec, nextRoot }), before);

    // pacman unlinks and recreates each file: new BUILD_ID, new executable.
    writeFileSync(path.join(web, ".next", "BUILD_ID"), "build-b\n");
    assert.notEqual(installFingerprint({ execPath: exec, nextRoot }), before);

    // Without a BUILD_ID the executable alone still tells.
    rmSync(path.join(web, ".next", "BUILD_ID"));
    const execOnly = installFingerprint({ execPath: exec, nextRoot });
    rmSync(exec);
    writeFileSync(exec, "newer binary");
    assert.notEqual(installFingerprint({ execPath: exec, nextRoot }), execOnly);

    assert.equal(installFingerprint({ execPath: path.join(dir, "missing"), nextRoot: path.join(dir, "none") }), null);
  } finally {
    cleanup();
  }
});

test("an AUR install (no $APPIMAGE, no package-type) is package-managed", () => {
  const { dir, cleanup } = tmpdir();
  try {
    assert.equal(isPackageManaged({ platform: "linux", env: {}, resourcesPath: dir }), true);
    assert.equal(isPackageManaged({ platform: "linux", env: { APPIMAGE: "/home/me/Timely.AppImage" }, resourcesPath: dir }), false);
    assert.equal(isPackageManaged({ platform: "win32", env: {}, resourcesPath: dir }), false);
    writeFileSync(path.join(dir, "package-type"), "pacman\n");
    assert.equal(isPackageManaged({ platform: "linux", env: {}, resourcesPath: dir }), false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tailscale Serve (HTTPS)
// ---------------------------------------------------------------------------

const DNS = "laptop.tail.ts.net";
const OURS = "http://127.0.0.1:48080";
const serveJson = (handlers, tcp = { HTTPS: true }) => ({ TCP: { 443: tcp }, Web: { [`${DNS}:443`]: { Handlers: handlers } } });

test("tailscale serve: who owns https://<dns>:443", () => {
  assert.deepEqual(serveOwner({}, DNS, OURS), { owner: "none" });
  assert.deepEqual(serveOwner(null, DNS, OURS), { owner: "none" });
  assert.deepEqual(serveOwner(serveJson({ "/": { Proxy: OURS } }), DNS, OURS), { owner: "ours" });
  assert.deepEqual(serveOwner(serveJson({ "/": { Proxy: "http://localhost:48080/" } }), DNS, OURS), { owner: "ours" });
  assert.equal(serveOwner(serveJson({ "/": { Proxy: "http://127.0.0.1:3000" } }), DNS, OURS).owner, "other");
  assert.equal(serveOwner(serveJson({ "/": { Proxy: OURS }, "/grafana": { Proxy: "http://127.0.0.1:3000" } }), DNS, OURS).owner, "other");
  assert.equal(serveOwner({ TCP: { 443: { TCPForward: "127.0.0.1:22" } } }, DNS, OURS).owner, "other");
  // Another port on the same name is not ours to worry about.
  assert.deepEqual(serveOwner({ TCP: { 8443: { HTTPS: true } }, Web: { [`${DNS}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:1" } } } } }, DNS, OURS), { owner: "none" });
});

function fakeServe(status) {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(" "));
    if (args[1] === "status") return { ok: true, output: JSON.stringify(status) };
    return { ok: true, output: "" };
  };
  return { run, calls };
}

test("tailscale serve: enable sets up an empty port, keeps ours, refuses someone else's", async () => {
  const empty = fakeServe({});
  assert.deepEqual(await enableServe(empty.run, DNS, OURS), { ok: true });
  assert.deepEqual(empty.calls, ["serve status --json", `serve --bg --https=443 ${OURS}`]);

  const ours = fakeServe(serveJson({ "/": { Proxy: OURS } }));
  assert.deepEqual(await enableServe(ours.run, DNS, OURS), { ok: true });
  assert.deepEqual(ours.calls, ["serve status --json"]);

  const other = fakeServe(serveJson({ "/": { Proxy: "http://127.0.0.1:3000" } }));
  const refused = await enableServe(other.run, DNS, OURS);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already used by Tailscale Serve/);
  assert.deepEqual(other.calls, ["serve status --json"]);

  // The API moved ports: Timely's earlier route is replaced, not refused.
  const moved = fakeServe(serveJson({ "/": { Proxy: "http://127.0.0.1:48090" } }));
  assert.deepEqual(await enableServe(moved.run, DNS, OURS, "http://127.0.0.1:48090"), { ok: true });
  assert.equal(moved.calls.at(-1), `serve --bg --https=443 ${OURS}`);
});

test("tailscale serve: disable only removes Timely's own route", async () => {
  const ours = fakeServe(serveJson({ "/": { Proxy: OURS } }));
  await disableServe(ours.run, DNS, OURS);
  assert.deepEqual(ours.calls, ["serve status --json", "serve --https=443 off"]);

  const other = fakeServe(serveJson({ "/": { Proxy: "http://127.0.0.1:3000" } }));
  await disableServe(other.run, DNS, OURS);
  assert.deepEqual(other.calls, ["serve status --json"]);
});

test("tailscale serve: failures say what to do", () => {
  assert.match(
    describeServeFailure("Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n"),
    /open https:\/\/login\.tailscale\.com\/f\/serve\?node=abc123, then try again/,
  );
  assert.match(describeServeFailure("serve config denied: Access denied: serve config denied"), /--operator=\$USER/);
  assert.match(describeServeFailure(""), /did not finish in time/);
});

// ---------------------------------------------------------------------------
// Start at login (supervisor side; loginItem.ts has its own test file)
// ---------------------------------------------------------------------------

const ON = { supported: true, on: true, blockedBySystem: false };

function fakeLoginItem(state = ON, { throws = false } = {}) {
  const calls = [];
  return {
    calls,
    loginItem: {
      read: () => ({ ...state }),
      sync(want, userAction, target) {
        calls.push([want, userAction, target]);
        if (throws) throw new Error("registry said no");
        return { ...state, on: want };
      },
    },
  };
}

function makeSupervisor(dir, loginItem, extra = {}) {
  return new Supervisor({
    userData: dir,
    resources: { api: path.join(dir, "res-api"), postgres: path.join(dir, "res-pg"), next: path.join(dir, "res-next"), agent: path.join(dir, "res-agent") },
    packaged: false,
    version: "0.5.0",
    sealer: plainSealer,
    nodeBinary: process.execPath,
    runAsNode: false,
    openPath: async () => "",
    writeClipboard: () => {},
    hostname: () => "laptop",
    sweepOrphans: false,
    loginItem,
    ...extra,
  });
}

function writeOldConfig(dir, extra = {}) {
  const file = userPaths(dir).configFile;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: "0.4.0", postgresPort: 54329, apiPort: 48080, webPort: 44001, setupDone: true, secrets: {}, ...extra }));
  return file;
}

test("start at login: an old config is turned on with the notice owed, and saved by the constructor", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const file = writeOldConfig(dir);
    const loaded = loadConfig(file, "0.5.0");
    assert.equal(loaded.upgraded, true);
    assert.equal(loaded.config.startAtLogin, true);
    assert.equal(loaded.config.loginNoticePending, true);
    const sup = makeSupervisor(dir, fakeLoginItem().loginItem);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.startAtLogin, true);
    assert.equal(saved.loginNoticePending, true);
    assert.equal(sup.getInstance().settings.startAtLogin, true);
    assert.deepEqual(sup.getInstance().loginItem, { supported: true, blockedBySystem: false, notice: true });
    assert.equal(sup.setupDone, true);
    sup.log.close();
    // Loaded again, it is no longer an upgrade.
    assert.equal(loadConfig(file, "0.5.0").upgraded, false);
  } finally {
    cleanup();
  }
});

test("start at login: a new install is on with no notice; an explicit false is kept; a corrupt file owes nothing", () => {
  const { dir, cleanup } = tmpdir();
  try {
    const file = path.join(dir, "config.json");
    const fresh = loadConfig(file, "0.5.0");
    assert.deepEqual([fresh.upgraded, fresh.config.startAtLogin, fresh.config.loginNoticePending], [false, true, false]);
    writeFileSync(file, JSON.stringify({ version: "0.5.0", startAtLogin: false }));
    const off = loadConfig(file, "0.5.0");
    assert.deepEqual([off.upgraded, off.config.startAtLogin, off.config.loginNoticePending], [false, false, false]);
    writeFileSync(file, JSON.stringify({ version: "0.5.0", startAtLogin: true, loginNoticePending: true }));
    assert.equal(loadConfig(file, "0.5.0").config.loginNoticePending, true);
    writeFileSync(file, "{broken");
    const corrupt = loadConfig(file, "0.5.0");
    assert.deepEqual([corrupt.upgraded, corrupt.config.startAtLogin, corrupt.config.loginNoticePending], [false, true, false]);

    const sup = makeSupervisor(path.join(dir, "new"), fakeLoginItem().loginItem);
    assert.equal(existsSync(userPaths(path.join(dir, "new")).configFile), false, "a new install is saved later, by boot");
    assert.deepEqual(sup.getInstance().loginItem, { supported: true, blockedBySystem: false, notice: false });
    sup.log.close();
  } finally {
    cleanup();
  }
});

test("start at login: the switch syncs as the person's action and never restarts the API", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    assert.ok(SETTING_KEYS.includes("startAtLogin"));
    writeOldConfig(dir, { startAtLogin: true });
    const fake = fakeLoginItem();
    const sup = makeSupervisor(dir, fake.loginItem);
    // restartApi() would throw here: the API was never started.
    const off = await sup.setSetting("startAtLogin", false);
    assert.deepEqual(fake.calls, [[false, true, undefined]]);
    assert.equal(off.settings.startAtLogin, false);
    assert.equal(JSON.parse(readFileSync(userPaths(dir).configFile, "utf8")).startAtLogin, false);
    await sup.setSetting("startAtLogin", true);
    assert.deepEqual(fake.calls.at(-1), [true, true, undefined]);
    sup.log.close();
  } finally {
    cleanup();
  }
});

test("start at login: using the switch clears the owed notice, so turning it back on shows no toast", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    writeOldConfig(dir);
    const sup = makeSupervisor(dir, fakeLoginItem().loginItem);
    assert.equal(sup.getInstance().loginItem.notice, true);
    await sup.setSetting("startAtLogin", false);
    const on = await sup.setSetting("startAtLogin", true);
    assert.equal(on.loginItem.notice, false);
    assert.equal(JSON.parse(readFileSync(userPaths(dir).configFile, "utf8")).loginNoticePending, false);
    // Another setting leaves it owed.
    const { dir: dir2, cleanup: cleanup2 } = tmpdir();
    try {
      writeOldConfig(dir2);
      const other = makeSupervisor(dir2, fakeLoginItem().loginItem);
      assert.equal((await other.setSetting("setupDone", true)).loginItem.notice, true);
      other.log.close();
    } finally {
      cleanup2();
    }
    sup.log.close();
  } finally {
    cleanup();
  }
});

test("start at login: dismissLoginNotice clears once, saves, and answers cleared to one caller", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    assert.ok(ACTIONS.includes("dismissLoginNotice"));
    writeOldConfig(dir);
    const sup = makeSupervisor(dir, fakeLoginItem().loginItem);
    const changes = [];
    sup.on("change", (instance) => changes.push(instance.loginItem.notice));
    const [first, second] = await Promise.all([sup.action("dismissLoginNotice"), sup.action("dismissLoginNotice")]);
    assert.deepEqual(first, { ok: true, cleared: true });
    assert.deepEqual(second, { ok: true, cleared: false });
    assert.deepEqual(changes, [false]);
    assert.equal(JSON.parse(readFileSync(userPaths(dir).configFile, "utf8")).loginNoticePending, false);
    assert.equal(sup.getInstance().loginItem.notice, false);
    sup.log.close();
  } finally {
    cleanup();
  }
});

test("start at login: an AppImage rename re-points the entry at boot's wish, not as the person's action", () => {
  const { dir, cleanup } = tmpdir();
  try {
    writeOldConfig(dir, { startAtLogin: true });
    const fake = fakeLoginItem();
    const sup = makeSupervisor(dir, fake.loginItem);
    sup.appImageMoved("/home/me/Timely-0.6.0.AppImage");
    assert.deepEqual(fake.calls, [[true, false, "/home/me/Timely-0.6.0.AppImage"]]);
    sup.log.close();
  } finally {
    cleanup();
  }
});

test("start at login: the updater's appimage-filename-updated reaches onAppImageMoved", async () => {
  const handlers = new Map();
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    logger: undefined,
    on(event, listener) {
      handlers.set(event, listener);
      return this;
    },
    checkForUpdates: async () => null,
    downloadUpdate: async () => {},
    quitAndInstall() {},
  };
  const moved = [];
  const updater = createElectronUpdater({ isPackaged: true, autoUpdater: fake, onAppImageMoved: (p) => moved.push(p) });
  await updater.check();
  assert.equal(fake.autoInstallOnAppQuit, true);
  handlers.get("appimage-filename-updated")("/home/me/Timely-0.6.0-linux-x86_64.AppImage");
  assert.deepEqual(moved, ["/home/me/Timely-0.6.0-linux-x86_64.AppImage"]);
});

test("start at login: loginItem in the snapshot is gated on support and on the setting", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    writeOldConfig(dir);
    const blocked = { supported: true, on: true, blockedBySystem: true };
    const sup = makeSupervisor(dir, fakeLoginItem(blocked).loginItem);
    // The system has it turned off: no notice claiming it starts at sign-in.
    assert.deepEqual(sup.getInstance().loginItem, { supported: true, blockedBySystem: true, notice: false });
    await sup.setSetting("startAtLogin", false);
    assert.deepEqual(sup.getInstance().loginItem, { supported: true, blockedBySystem: false, notice: false });
    sup.log.close();

    // Outside the installed app nothing is claimed, notice included.
    const { dir: dir2, cleanup: cleanup2 } = tmpdir();
    try {
      writeOldConfig(dir2);
      const dev = makeSupervisor(dir2, fakeLoginItem({ supported: false, on: false, blockedBySystem: false }).loginItem);
      assert.deepEqual(dev.getInstance().loginItem, { supported: false, blockedBySystem: false, notice: false });
      dev.log.close();
      const none = makeSupervisor(dir2, undefined);
      assert.deepEqual(none.getInstance().loginItem, { supported: false, blockedBySystem: false, notice: false });
      none.log.close();
    } finally {
      cleanup2();
    }
  } finally {
    cleanup();
  }
});

test("start at login: a throwing sync is logged, not thrown", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    writeOldConfig(dir, { startAtLogin: true });
    const fake = fakeLoginItem(ON, { throws: true });
    const sup = makeSupervisor(dir, fake.loginItem);
    const instance = await sup.setSetting("startAtLogin", false);
    assert.equal(instance.settings.startAtLogin, false);
    sup.appImageMoved("/x.AppImage");
    assert.equal(fake.calls.length, 2);
    sup.log.close();
    assert.match(readFileSync(path.join(userPaths(dir).logDir, "supervisor.log"), "utf8"), /login item: registry said no/);
  } finally {
    cleanup();
  }
});

test("start at login: boot syncs the login item first, before the database", async () => {
  const { dir, cleanup } = tmpdir();
  try {
    writeOldConfig(dir, { startAtLogin: true });
    const fake = fakeLoginItem();
    const sup = makeSupervisor(dir, fake.loginItem);
    const steps = [];
    sup.on("boot", (p) => steps.push([p.step, p.state, fake.calls.length]));
    // No Postgres binaries here: boot fails at the database step, after the sync.
    await assert.rejects(sup.boot(), (error) => error.step === "postgres");
    assert.deepEqual(fake.calls[0], [true, false, undefined]);
    assert.deepEqual(steps[0], ["postgres", "pending", 1]);
    sup.log.close();
  } finally {
    cleanup();
  }
});
