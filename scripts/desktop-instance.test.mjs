import assert from "node:assert/strict";
import test from "node:test";
import {
  canToggleTailscale,
  codeTimeLeft,
  describeHttps,
  describeSidecar,
  describeTailscale,
  describeUpdate,
  loginItemRow,
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
  assert.equal(describeUpdate({ status: "managed" }).label, "Updated by your package manager");
});

test("onboarding goes to the wizard once inside the desktop app, otherwise to the calendar", () => {
  assert.equal(routeAfterOnboarding(null), "/calendar");
  assert.equal(routeAfterOnboarding({ settings: { tailscaleEnabled: false, allowRegistration: true, setupDone: false } }), "/setup");
  assert.equal(routeAfterOnboarding({ settings: { tailscaleEnabled: false, allowRegistration: true, setupDone: true } }), "/calendar");
});

test("a sign-in code rides along in the QR only while it is valid", () => {
  const withCode = JSON.parse(pairingPayload(instance, "pair_abc"));
  assert.equal(withCode.code, "pair_abc");
  assert.deepEqual(withCode.urls, instance.pairing.urls);
  assert.equal(JSON.parse(pairingPayload(instance)).code, undefined);
  const now = Date.parse("2026-10-30T10:00:00Z");
  assert.equal(codeTimeLeft("2026-10-30T10:05:00Z", now), "5:00");
  assert.equal(codeTimeLeft("2026-10-30T10:00:01.200Z", now), "0:02");
  assert.equal(codeTimeLeft("2026-10-30T10:00:00Z", now), null);
  assert.equal(codeTimeLeft("not a date", now), null);
});

test("HTTPS status follows both switches and the Serve state", () => {
  const at = (settings, https) => describeHttps({ settings: { ...instance.settings, ...settings }, tailscale: { ...instance.tailscale, https } });
  assert.equal(at({ tailscaleHttps: false }, { status: "on", url: "https://x" }).label, "Off");
  assert.equal(at({ tailscaleEnabled: false, tailscaleHttps: true }, { status: "on" }).label, "Off");
  assert.equal(at({ tailscaleHttps: true }, { status: "on", url: "https://x.ts.net" }).tone, "ok");
  assert.equal(at({ tailscaleHttps: true }, { status: "starting" }).tone, "warn");
  const failed = at({ tailscaleHttps: true }, { status: "error", error: "Turn on HTTPS" });
  assert.equal(failed.tone, "danger");
  assert.equal(failed.detail, "Turn on HTTPS");
});

test("the start-at-login row never shows On while the system turned the entry off", () => {
  const at = (startAtLogin, loginItem, platform = "win32") =>
    loginItemRow({ settings: { ...instance.settings, startAtLogin }, loginItem: { notice: false, ...loginItem } }, platform);
  const ON = "Opens hidden in the tray, so bots keep watching";
  const OFF = "Bots only check while Timely is open";
  const WINDOWS = "Windows turned this off in Startup apps. Turn it on here to start Timely when you sign in.";
  const DESKTOP = "Your desktop turned this off in its startup settings. Turn it on here to start Timely when you sign in.";
  const table = [
    ["on", at(true, { supported: true, blockedBySystem: false }), { checked: true, disabled: false, meta: ON, hint: null }],
    ["off", at(false, { supported: true, blockedBySystem: false }), { checked: false, disabled: false, meta: OFF, hint: null }],
    ["unsupported", at(true, { supported: false, blockedBySystem: false }), { checked: false, disabled: true, meta: OFF, hint: "Works in the installed app." }],
    ["blocked on win32", at(true, { supported: true, blockedBySystem: true }), { checked: false, disabled: false, meta: OFF, hint: WINDOWS }],
    ["blocked on linux", at(true, { supported: true, blockedBySystem: true }, "linux"), { checked: false, disabled: false, meta: OFF, hint: DESKTOP }],
    ["blocked on darwin", at(true, { supported: true, blockedBySystem: true }, "darwin"), { checked: false, disabled: false, meta: OFF, hint: DESKTOP }],
  ];
  for (const [name, got, want] of table) assert.deepEqual(got, want, name);
  for (const meta of [ON, OFF]) assert.ok(meta.length <= 48, `"${meta}" fits the row without truncating`);
});

// Instance settings (phase 5): who may use this computer, said the same on web and phone.
import {
  HOST_DESKTOP_ONLY,
  HOST_LIMIT_COPY,
  agentLimitsError,
  hostAccountRows,
  hostSectionState,
  parseWholeNumber,
  phoneHostLine,
  saveFailureMessage,
  sourceLabel,
  workingFolderLabel,
} from "../packages/contract/src/instanceSettings.ts";

const hostSettings = {
  hostAccounts: [
    { uid: "usr_b", email: "bob@example.test", workingDir: "", source: "server" },
    { uid: "usr_a", email: "alice@example.test", workingDir: "/home/alice/project", source: "desktop" },
    { uid: "usr_c", email: "", workingDir: "", source: "desktop" },
  ],
  otherHostAccounts: 2,
  thisAccountHostAllowed: true,
  thisAccountWorkingDir: "/home/alice/project",
  maxWorkers: 3,
  idleMinutes: 15,
  shell: false,
};

test("host accounts: the signed-in account's row comes first, each says where it was turned on and its folder", () => {
  const rows = hostAccountRows(hostSettings, "usr_a");
  assert.deepEqual(rows.map((r) => r.uid), ["usr_a", "usr_b", "usr_c"]);
  assert.equal(rows[0].you, "You");
  assert.equal(rows[1].you, "");
  assert.equal(rows[0].sourceLabel, "Turned on in the desktop app");
  assert.equal(rows[1].sourceLabel, "Set by the server");
  assert.equal(rows[0].folder, "/home/alice/project");
  assert.match(rows[1].folder, /^Not chosen/);
  assert.equal(rows[2].title, "Account", "an unreadable email does not leave a blank row");
  assert.deepEqual(hostAccountRows(hostSettings, null).map((r) => r.you), ["", "", ""]);
  assert.equal(sourceLabel("server"), "Set by the server");
  assert.equal(workingFolderLabel("  "), workingFolderLabel(""));
});

test("host section: editable only in the desktop window, and a server-set account cannot be turned off there", () => {
  const outside = hostSectionState(hostSettings, false, "desktop");
  assert.equal(outside.editable, false);
  assert.equal(outside.canTurnOff, false);
  assert.equal(outside.note, HOST_DESKTOP_ONLY);
  assert.equal(outside.checked, true);
  const inside = hostSectionState(hostSettings, true, "desktop");
  assert.deepEqual(inside, { editable: true, canTurnOff: true, checked: true, note: "" });
  const server = hostSectionState(hostSettings, true, "server");
  assert.equal(server.editable, true);
  assert.equal(server.canTurnOff, false);
  assert.match(server.note, /TIMELY_AGENT_HOST_ACCOUNTS/);
  const off = hostSectionState({ ...hostSettings, thisAccountHostAllowed: false }, true, null);
  assert.deepEqual(off, { editable: true, canTurnOff: true, checked: false, note: "" });
  assert.match(HOST_LIMIT_COPY, /runs as you on this computer/);
  assert.match(HOST_LIMIT_COPY, /every account's data/);
});

test("phone: a read-only Yes or No for this account", () => {
  assert.equal(phoneHostLine(hostSettings).value, "Yes");
  assert.equal(phoneHostLine({ ...hostSettings, thisAccountHostAllowed: false }).value, "No");
  assert.match(phoneHostLine({ ...hostSettings, thisAccountHostAllowed: false }).hint, /desktop app/);
  assert.equal(phoneHostLine(null).value, "—");
  assert.equal(phoneHostLine(hostSettings).label, "This account can use the computer");
});

test("worker limits: whole numbers inside what the server accepts", () => {
  assert.equal(agentLimitsError(3, 15), null);
  assert.equal(agentLimitsError(1, 1), null);
  assert.equal(agentLimitsError(16, 240), null);
  for (const [workers, idle] of [[0, 15], [17, 15], [1.5, 15], [Number.NaN, 15], ["3", 15], [3, 0], [3, 241], [3, Number.NaN], [3, 2.5]]) {
    assert.notEqual(agentLimitsError(workers, idle), null, `${workers} ${idle}`);
  }
  assert.equal(parseWholeNumber(" 12 "), 12);
  for (const text of ["", "1.5", "-2", "abc", "1e3", "12345"]) assert.ok(Number.isNaN(parseWholeNumber(text)), text);
  assert.match(agentLimitsError(parseWholeNumber("x"), 5), /Workers must be a whole number from 1 to 16/);
});

test("a refused save says why in plain words", () => {
  assert.equal(saveFailureMessage(400, "That folder doesn't exist on this computer."), "That folder doesn't exist on this computer.");
  assert.match(saveFailureMessage(404, undefined), /desktop app/);
  assert.match(saveFailureMessage(401, undefined), /Sign in again/);
  assert.match(saveFailureMessage(500, undefined), /500/);
});
