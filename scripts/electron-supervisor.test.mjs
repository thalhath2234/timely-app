import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { apiBinds, buildApiEnv } from "../apps/web/electron/supervisor/api.ts";
import { copyDataDir, manualBackupName, preUpgradeBackupName, pruneBackups } from "../apps/web/electron/supervisor/backup.ts";
import {
  DEFAULT_PORTS,
  ensureSecrets,
  loadConfig,
  makeSealer,
  plainSealer,
  saveConfig,
} from "../apps/web/electron/supervisor/config.ts";
import { checkPrivileges } from "../apps/web/electron/supervisor/guards.ts";
import { pairingPayload, tailscaleUrls } from "../apps/web/electron/supervisor/index.ts";
import { resolveResourceDirs, userPaths } from "../apps/web/electron/supervisor/paths.ts";
import { findFreePort, isPortFree, listenPort, reconcilePorts } from "../apps/web/electron/supervisor/ports.ts";
import { classifyPidFile, isPostgresCommand, parsePostmasterPid, probePostgres } from "../apps/web/electron/supervisor/postgres.ts";
import { fallbackPath, lastLine } from "../apps/web/electron/supervisor/shellEnv.ts";
import { DEFAULT_BACKOFF, initialBackoff, planRestart } from "../apps/web/electron/supervisor/sidecar.ts";
import {
  expandIPv6,
  isTailscaleIPv4,
  isTailscaleIPv6,
  mergeStatus,
  scanInterfaces,
  urlFor,
} from "../apps/web/electron/supervisor/tailscale.ts";

function tmpdir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "timely-supervisor-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// config.json
// ---------------------------------------------------------------------------

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
  assert.deepEqual(cli, { installed: true, running: true, ipv4: "100.64.1.1", ipv6: "fd7a:115c:a1e0::2", hostname: "laptop" });

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

test("paths: resource resolution for packaged, override and staged dev layouts", () => {
  const packaged = resolveResourceDirs({ isPackaged: true, resourcesPath: "/opt/Timely/resources", appPath: "/opt/Timely/resources/app.asar", platform: "linux", arch: "x64", env: {} });
  assert.deepEqual(packaged, { api: "/opt/Timely/resources/api", postgres: "/opt/Timely/resources/postgres", next: "/opt/Timely/resources/next-server" });

  const staged = resolveResourceDirs({ isPackaged: false, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "darwin", arch: "arm64", env: {} });
  assert.deepEqual(staged, { api: "/repo/apps/web/.electron-api/mac-arm64", postgres: "/repo/apps/web/.electron-postgres/mac-arm64", next: "/repo/apps/web/.electron-next" });

  const override = resolveResourceDirs({ isPackaged: true, resourcesPath: "/x", appPath: "/repo/apps/web", platform: "linux", arch: "x64", env: { TIMELY_RESOURCES_DIR: "/tmp/res" } });
  assert.equal(override.api, "/tmp/res/api");
  assert.equal(override.postgres, "/tmp/res/postgres");
  assert.equal(override.next, "/repo/apps/web/.electron-next", "falls back to the staged Next output when the override has none");

  const paths = userPaths("/home/me/.config/Timely");
  assert.equal(paths.configFile, "/home/me/.config/Timely/config.json");
  assert.equal(paths.pgData, "/home/me/.config/Timely/postgres/data");
  assert.equal(paths.dataDir, "/home/me/.config/Timely/data");
  assert.equal(paths.backupDir, "/home/me/.config/Timely/backups");
  assert.equal(paths.logDir, "/home/me/.config/Timely/logs");
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
