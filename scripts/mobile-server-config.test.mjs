import assert from "node:assert/strict";
import test from "node:test";
import {
  createServerStore,
  isInsecureServerUrl,
  normalizeServerConfig,
  orderCandidates,
  parseHealthPayload,
  parsePairingInput,
  pickReachable,
  SERVER_CONFIG_KEY,
} from "../apps/mobile/lib/server/config.ts";

// Phase 4 of issue #61: the phone learns its server at runtime. These tests
// cover the pure core (lib/server/config.ts); SecureStore and fetch are
// injected, so nothing here needs React Native.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

test("parsePairingInput accepts the desktop QR payload", () => {
  const text = JSON.stringify({
    v: 1,
    name: "my-laptop",
    urls: ["http://100.101.102.103:48080", "http://127.0.0.1:48080"],
  });
  assert.deepEqual(parsePairingInput(text), {
    urls: ["http://100.101.102.103:48080", "http://127.0.0.1:48080"],
    name: "my-laptop",
  });
});

test("parsePairingInput accepts a bare URL and strips the trailing slash", () => {
  assert.deepEqual(parsePairingInput("  https://timely.example.com/  "), { urls: ["https://timely.example.com"] });
  assert.deepEqual(parsePairingInput("http://[fd7a:115c:a1e0::1]:48080///"), {
    urls: ["http://[fd7a:115c:a1e0::1]:48080"],
  });
});

test("parsePairingInput rejects text that is neither", () => {
  assert.equal(parsePairingInput(""), null);
  assert.equal(parsePairingInput("my-laptop"), null);
  assert.equal(parsePairingInput("100.101.102.103:48080"), null);
  assert.equal(parsePairingInput("ftp://example.com"), null);
  assert.equal(parsePairingInput("http://has space.com"), null);
  assert.equal(parsePairingInput("{not json"), null);
  assert.equal(parsePairingInput(JSON.stringify({ v: 1, name: "x" })), null);
  assert.equal(parsePairingInput(JSON.stringify({ v: 1, urls: ["mailto:a@b"] })), null);
  assert.equal(parsePairingInput(JSON.stringify([])), null);
});

test("parsePairingInput de-duplicates while keeping order and skips bad entries", () => {
  const text = JSON.stringify({
    v: 1,
    name: "   ",
    urls: ["http://a:1/", "http://b:2", 42, "http://a:1", "nope", "http://b:2/"],
  });
  assert.deepEqual(parsePairingInput(text), { urls: ["http://a:1", "http://b:2"] });
});

test("orderCandidates puts the remembered address first and keeps the others in order", () => {
  const urls = ["http://a:1", "http://b:2", "http://c:3"];
  assert.deepEqual(orderCandidates({ urls, active: "http://b:2" }), ["http://b:2", "http://a:1", "http://c:3"]);
  assert.deepEqual(orderCandidates({ urls }), urls);
  assert.deepEqual(orderCandidates({ urls, active: "http://zzz:9" }), ["http://zzz:9", ...urls]);
});

test("pickReachable prefers a slow first address over a fast second one", async () => {
  const calls = [];
  const probe = async (url) => {
    calls.push({ url, at: Date.now() });
    if (url === "http://first") {
      await sleep(60);
      return { status: "ok", version: "first" };
    }
    await sleep(1);
    return { status: "ok", version: "second" };
  };
  const found = await pickReachable(["http://first", "http://second"], probe, { timeoutMs: 500 });
  assert.deepEqual(found, { url: "http://first", result: { status: "ok", version: "first" } });
  assert.equal(calls.length, 2, "both probes start at once");
  assert.ok(calls[1].at - calls[0].at < 40, "the second probe must not wait for the first to finish");
});

test("pickReachable falls through when the first address fails", async () => {
  const probe = async (url) => {
    if (url === "http://dead") throw new TypeError("Network request failed");
    return { status: "ok" };
  };
  assert.deepEqual(await pickReachable(["http://dead", "http://alive"], probe), {
    url: "http://alive",
    result: { status: "ok" },
  });
});

test("pickReachable times out a hanging address and aborts the losers", async () => {
  const aborted = [];
  const probe = (url, signal) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted.push(url);
        reject(new Error("aborted"));
      });
      if (url === "http://quick") setTimeout(() => resolve({ status: "ok" }), 5);
      // "http://hang" never settles on its own.
    });
  const started = Date.now();
  const found = await pickReachable(["http://hang", "http://quick", "http://later"], probe, { timeoutMs: 40 });
  assert.deepEqual(found, { url: "http://quick", result: { status: "ok" } });
  assert.ok(Date.now() - started >= 35, "waited for the first address to time out");
  assert.ok(Date.now() - started < 400, "did not wait longer than the timeout");
  assert.deepEqual(aborted.sort(), ["http://hang", "http://later"]);
});

test("pickReachable resolves null when nothing answers", async () => {
  const probe = async () => {
    throw new Error("nope");
  };
  assert.equal(await pickReachable(["http://a", "http://b"], probe, { timeoutMs: 20 }), null);
  assert.equal(await pickReachable([], probe), null);
  const throwsSync = () => {
    throw new Error("sync");
  };
  assert.equal(await pickReachable(["http://a"], throwsSync), null);
});

test("the store round-trips a config, normalizes it, and clears", async () => {
  const storage = memoryStorage();
  const store = createServerStore(storage);
  assert.equal(await store.load(), null);

  const saved = await store.save({
    urls: ["http://100.1.2.3:48080/", "http://127.0.0.1:48080", "http://100.1.2.3:48080"],
    active: "http://127.0.0.1:48080/",
    name: " my-laptop ",
  });
  assert.deepEqual(saved, {
    urls: ["http://100.1.2.3:48080", "http://127.0.0.1:48080"],
    active: "http://127.0.0.1:48080",
    name: "my-laptop",
  });
  assert.deepEqual(Object.keys(storage.dump()), [SERVER_CONFIG_KEY]);
  assert.deepEqual(await store.load(), saved);

  await store.clear();
  assert.equal(await store.load(), null);
  await store.clear(); // idempotent
});

test("the store ignores corrupt or empty stored values and refuses an empty list", async () => {
  assert.equal(await createServerStore(memoryStorage({ [SERVER_CONFIG_KEY]: "{oops" })).load(), null);
  assert.equal(await createServerStore(memoryStorage({ [SERVER_CONFIG_KEY]: '{"urls":[]}' })).load(), null);
  await assert.rejects(() => createServerStore(memoryStorage()).save({ urls: ["nope"] }));
});

test("normalizeServerConfig drops an active address that is not in the list", () => {
  assert.deepEqual(normalizeServerConfig({ urls: ["http://a"], active: "http://b" }), { urls: ["http://a"] });
  assert.equal(normalizeServerConfig(null), null);
  assert.equal(normalizeServerConfig("http://a"), null);
});

test("parseHealthPayload keeps the contract fields and rejects other servers", () => {
  assert.deepEqual(
    parseHealthPayload({
      status: "ok",
      version: "0.1.0",
      db: "ok",
      migrations: { version: 20261002130631, pending: 0 },
      registrationOpen: true,
      uptimeSeconds: 42,
      extra: "ignored",
    }),
    {
      status: "ok",
      version: "0.1.0",
      db: "ok",
      migrations: { version: 20261002130631, pending: 0 },
      registrationOpen: true,
      uptimeSeconds: 42,
    },
  );
  assert.deepEqual(parseHealthPayload({ status: "degraded", db: "dial tcp: refused" }), {
    status: "degraded",
    db: "dial tcp: refused",
  });
  assert.equal(parseHealthPayload({ ok: true }), null);
  assert.equal(parseHealthPayload("<html>"), null);
});

test("plain http is flagged only outside loopback and Tailscale", () => {
  for (const url of [
    "http://127.0.0.1:48080",
    "http://localhost:8080",
    "http://10.0.2.2:8080",
    "http://100.101.102.103:48080",
    "http://[fd7a:115c:a1e0::1]:48080",
    "http://desktop.tail1234.ts.net:48080",
    "https://192.168.1.20:8080",
    "https://timely.example.com",
  ]) {
    assert.equal(isInsecureServerUrl(url), false, url);
  }
  for (const url of ["http://192.168.1.20:8080", "http://100.128.0.1:8080", "http://timely.example.com", "http://[2001:db8::1]:80"]) {
    assert.equal(isInsecureServerUrl(url), true, url);
  }
});
