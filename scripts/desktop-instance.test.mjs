import assert from "node:assert/strict";
import test from "node:test";
import {
  canToggleTailscale,
  describeSidecar,
  describeTailscale,
  describeUpdate,
  pairingPayload,
  pairingUrls,
  primaryAddress,
  routeAfterOnboarding,
} from "../apps/web/app/utils/desktopInstance.ts";

// Settings → Server helpers (issue #61, Phase 3). Pure functions over the
// DesktopInstance contract in apps/web/electron-env.d.ts.

const instance = {
  pairing: { v: 1, name: "my-laptop", urls: ["http://100.101.102.103:48080", "http://127.0.0.1:48080"] },
  api: { status: "running", restarts: 0, port: 48080, localUrl: "http://127.0.0.1:48080", tailscaleUrls: [], bind: [] },
  tailscale: { installed: true, running: true, ipv4: "100.101.102.103", hostname: "my-laptop" },
  settings: { tailscaleEnabled: true, allowRegistration: true, setupDone: false },
};

test("the QR encodes the pairing payload verbatim, Tailscale address first", () => {
  assert.equal(
    pairingPayload(instance),
    '{"v":1,"name":"my-laptop","urls":["http://100.101.102.103:48080","http://127.0.0.1:48080"]}',
  );
  assert.deepEqual(pairingUrls(instance), instance.pairing.urls);
  assert.equal(primaryAddress(instance), "http://100.101.102.103:48080");
  assert.equal(
    primaryAddress({ pairing: { v: 1, name: "x", urls: [] }, api: instance.api }),
    "http://127.0.0.1:48080",
    "falls back to the loopback address when the payload has no URLs",
  );
});

test("sidecar status copy is plain language and carries the last error", () => {
  assert.deepEqual(describeSidecar({ status: "running", restarts: 0 }), { label: "Running", tone: "ok", detail: undefined });
  assert.equal(describeSidecar({ status: "running", restarts: 2 }).detail, "Restarted 2 times recently");
  assert.equal(describeSidecar({ status: "running", restarts: 1 }).detail, "Restarted 1 time recently");
  const crashed = describeSidecar({ status: "crashed", restarts: 3, lastError: "exited with code 1" });
  assert.equal(crashed.tone, "danger");
  assert.equal(crashed.detail, "exited with code 1");
  assert.equal(describeSidecar({ status: "crashed", restarts: 0 }).detail, "Timely will try to start it again.");
  assert.equal(describeSidecar({ status: "starting", restarts: 0 }).label, "Starting…");
  assert.equal(describeSidecar({ status: "stopped", restarts: 0 }).tone, "muted");
});

test("Tailscale state drives the install hint, the connect hint, and the toggle", () => {
  const missing = describeTailscale({ installed: false, running: false }, false);
  assert.equal(missing.label, "Not installed");
  assert.match(missing.detail, /Install Tailscale/);
  assert.equal(canToggleTailscale({ tailscale: { installed: false, running: false } }), false);

  const offline = describeTailscale({ installed: true, running: false }, true);
  assert.equal(offline.tone, "warn");
  assert.match(offline.detail, /not connected/);

  assert.equal(describeTailscale(instance.tailscale, false).label, "Connected, Tailscale access off");
  const on = describeTailscale(instance.tailscale, true);
  assert.equal(on.tone, "ok");
  assert.match(on.detail, /my-laptop/);
  assert.equal(canToggleTailscale(instance), true);
});

test("update status copy names the version when known", () => {
  assert.equal(describeUpdate({ status: "idle" }).label, "Not checked yet");
  assert.equal(describeUpdate({ status: "available", version: "0.2.0" }).label, "Version 0.2.0 is available");
  assert.equal(describeUpdate({ status: "ready" }).label, "Update ready to install");
  assert.equal(describeUpdate({ status: "upToDate" }).tone, "ok");
  const failed = describeUpdate({ status: "error", error: "offline" });
  assert.equal(failed.tone, "danger");
  assert.equal(failed.detail, "offline");
});

test("onboarding goes to the wizard once inside the desktop app, otherwise to the calendar", () => {
  assert.equal(routeAfterOnboarding(null), "/calendar");
  assert.equal(routeAfterOnboarding({ settings: { tailscaleEnabled: false, allowRegistration: true, setupDone: false } }), "/setup");
  assert.equal(routeAfterOnboarding({ settings: { tailscaleEnabled: false, allowRegistration: true, setupDone: true } }), "/calendar");
});
