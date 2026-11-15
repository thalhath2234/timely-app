import assert from "node:assert/strict";
import test from "node:test";
import { parseAlertPayload } from "../apps/web/electron/alerts.ts";
import { isOpenableExternally, isPermissionAllowed, isSameOrigin } from "../apps/web/electron/origin.ts";

// QA-07: the desktop popup guard must compare origins, not URL prefixes.
const origin = "http://localhost:4002";

test("same-origin URLs are allowed in the app window", () => {
  assert.equal(isSameOrigin("http://localhost:4002/", origin), true);
  assert.equal(isSameOrigin("http://localhost:4002/docs/abc?x=1#y", origin), true);
});

test("userinfo and lookalike hosts that share the prefix are rejected", () => {
  assert.equal(isSameOrigin("http://localhost:4002@attacker.example/", origin), false);
  assert.equal(isSameOrigin("http://localhost:40021/", origin), false);
  assert.equal(isSameOrigin("https://localhost:4002/", origin), false);
  assert.equal(
    isSameOrigin("https://trusted.example.attacker.example/", "https://trusted.example"),
    false,
  );
  assert.equal(isSameOrigin("https://trusted.example/", "https://trusted.example"), true);
});

test("malformed URLs are neither allowed nor opened externally", () => {
  for (const url of ["", "not a url", "javascript:alert(1)", "file:///etc/passwd", "about:blank"]) {
    assert.equal(isSameOrigin(url, origin), false, url);
    assert.equal(isOpenableExternally(url), false, url);
  }
});

test("web and mail links may be handed to the system", () => {
  assert.equal(isOpenableExternally("https://example.com/page"), true);
  assert.equal(isOpenableExternally("http://example.com/page"), true);
  assert.equal(isOpenableExternally("mailto:hello@example.com"), true);
});

test("web permissions are limited to the renderer origin and the app's needs", () => {
  assert.equal(isPermissionAllowed("clipboard-read", "http://localhost:4002/sheets/1", origin), true);
  assert.equal(isPermissionAllowed("clipboard-sanitized-write", "http://localhost:4002/", origin), true);
  assert.equal(isPermissionAllowed("clipboard-read", "https://attacker.example/", origin), false);
  for (const permission of ["media", "geolocation", "notifications", "openExternal", "hid"]) {
    assert.equal(isPermissionAllowed(permission, "http://localhost:4002/", origin), false, permission);
  }
});

// Bot alert pop-ups: the renderer's payload is checked before it reaches a native notification.
const alertId = "ntf_3f2c1a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f";

test("bot alert payloads with a notification id are accepted", () => {
  assert.deepEqual(parseAlertPayload({ id: alertId, title: "BTC dip: below 25,000", body: "now $24,900", extra: 1 }), {
    id: alertId,
    title: "BTC dip: below 25,000",
    body: "now $24,900",
  });
  assert.deepEqual(parseAlertPayload({ id: alertId, title: "Watcher: page changed", body: "" }), {
    id: alertId,
    title: "Watcher: page changed",
    body: "",
  });
});

test("bot alert payloads without a notification id or text are refused", () => {
  for (const id of ["chat_x", "ntf_../x", "ntf_", "ntf_ABC", ` ${alertId}`, `${alertId}\n`, 7, null]) {
    assert.equal(parseAlertPayload({ id, title: "t", body: "b" }), null, String(id));
  }
  for (const payload of [null, undefined, "ntf_1", 42, [alertId, "t", "b"]]) {
    assert.equal(parseAlertPayload(payload), null, String(payload));
  }
  assert.equal(parseAlertPayload({ id: alertId, title: 5, body: "b" }), null);
  assert.equal(parseAlertPayload({ id: alertId, title: "t", body: { text: "b" } }), null);
  assert.equal(parseAlertPayload({ id: alertId, title: "   ", body: "b" }), null);
  assert.equal(parseAlertPayload({ id: `ntf_${"a".repeat(100)}`, title: "t", body: "b" }), null);
});

test("long bot alert text is clipped, never splitting a character", () => {
  const alert = parseAlertPayload({ id: alertId, title: "T".repeat(500), body: "B".repeat(5000) });
  assert.equal(alert?.title, "T".repeat(100));
  assert.equal(alert?.body, "B".repeat(200));
  const emoji = parseAlertPayload({ id: alertId, title: "\u{1F4C8}".repeat(150), body: "ok" });
  assert.equal(Array.from(emoji?.title ?? "").length, 100);
  assert.equal(emoji?.title, "\u{1F4C8}".repeat(100));
});

// ---------------------------------------------------------------------------
// The desktop window's requests (plan 11.4): a fixed list, no token in a page
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { SHELL_OPS, SHELL_OP_NAMES, isShellOp, planShellRequest } from "../apps/web/electron/shellOps.ts";

const read = (file) => readFileSync(new URL(`../apps/web/${file}`, import.meta.url), "utf8");

test("shell requests: the list is exactly the operations the plan names", () => {
  assert.deepEqual([...SHELL_OP_NAMES].sort(), [
    "agentLimits.set",
    "chat.hostApproval",
    "chat.permission",
    "hostAccounts.set",
    "hostAccounts.workingDir",
    "instance.settings",
    "settings.permissions",
  ]);
  // electron-env.d.ts names the same operations, so a page's types cannot ask for another.
  const env = read("electron-env.d.ts");
  const union = env.slice(env.indexOf("export type ShellOp ="), env.indexOf("export type ShellResult"));
  const declared = [...union.matchAll(/\| "([A-Za-z.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), [...SHELL_OP_NAMES].sort());
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "", "chat.delete", "instance.get"]) {
    assert.equal(isShellOp(name), false, name);
  }
  assert.equal(isShellOp(undefined), false);
  assert.equal(isShellOp({ toString: () => "instance.settings" }), false);
});

test("shell requests: each operation builds only its own API route", () => {
  assert.deepEqual(planShellRequest("instance.settings", undefined), { method: "GET", path: "/instance/settings" });
  assert.deepEqual(planShellRequest("hostAccounts.set", { uid: "u1", on: false }), { method: "PUT", path: "/instance/host-accounts", body: { uid: "u1", on: false } });
  assert.deepEqual(planShellRequest("hostAccounts.workingDir", { uid: "u1", workingDir: "/tmp/x" }), { method: "PUT", path: "/instance/host-accounts", body: { uid: "u1", workingDir: "/tmp/x" } });
  assert.deepEqual(planShellRequest("agentLimits.set", { maxWorkers: 2, idleMinutes: 10 }), { method: "PUT", path: "/instance/agent-limits", body: { maxWorkers: 2, idleMinutes: 10 } });
  assert.deepEqual(planShellRequest("chat.permission", { chatId: "chat_ab-1", permission: "full" }), { method: "PATCH", path: "/chats/chat_ab-1", body: { permission: "full" } });
  assert.deepEqual(planShellRequest("settings.permissions", { hostApprovalRule: "desktop", hostApprovalTimeoutMinutes: 30 }), {
    method: "PATCH",
    path: "/agent/chat-settings",
    body: { hostApprovalRule: "desktop", hostApprovalTimeoutMinutes: 30 },
  });
  assert.deepEqual(planShellRequest("chat.hostApproval", { chatId: "c1", revision: 3, requestId: "r1", choice: "chat" }), {
    method: "POST",
    path: "/chats/c1/host-approval",
    body: { revision: 3, requestId: "r1", choice: "chat" },
  });
  // Every listed route stays under the paths the API serves for the desktop window.
  for (const [op, spec] of Object.entries(SHELL_OPS)) {
    const path = spec.path({ chatId: "c1" });
    assert.match(path, /^\/(instance\/|chats\/c1|agent\/chat-settings)/, op);
  }
});

test("shell requests: unknown fields, wrong types, path tricks and oversized input are refused", () => {
  const refuse = (op, body, message) => assert.throws(() => planShellRequest(op, body), message, `${op} ${JSON.stringify(body)}`);
  refuse("nope", {}, /Unknown request/);
  refuse("hostAccounts.set", { uid: "u1", on: true, extra: 1 }, /Unknown field extra/);
  refuse("hostAccounts.set", { uid: "u1" }, /invalid field on/);
  refuse("hostAccounts.set", { uid: 7, on: true }, /invalid field uid/);
  refuse("hostAccounts.set", { uid: "a\0b", on: true }, /invalid field uid/);
  refuse("agentLimits.set", { maxWorkers: 1.5, idleMinutes: 3 }, /invalid field maxWorkers/);
  refuse("agentLimits.set", { maxWorkers: Number.NaN, idleMinutes: 3 }, /invalid field maxWorkers/);
  refuse("hostAccounts.set", [1, 2], /must be an object/);
  refuse("hostAccounts.set", "uid", /must be an object/);
  for (const chatId of ["", "../x", "a/b", "a?b", "a#b", "a b", "a%2fb", "x".repeat(81)]) {
    refuse("chat.permission", { chatId, permission: "full" }, /Invalid chat id/);
    refuse("chat.hostApproval", { chatId, revision: 1, requestId: "r", choice: "once" }, /Invalid chat id/);
  }
  refuse("settings.permissions", { "bad key": 1 }, /Bad field/);
  refuse("settings.permissions", { nested: { a: 1 } }, /Bad field nested/);
  refuse("settings.permissions", { list: [1] }, /Bad field list/);
  refuse("settings.permissions", Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])), /Too many fields/);
  refuse("instance.settings", { chatId: "../x" }, /Unknown field/);
});

test("preload exposes the shell bridge only in hosted mode, only the listed operations, and never the token", () => {
  const preload = read("electron/preload.ts");
  // Inside the hosted-only spread, next to instance, and nowhere else.
  const hosted = preload.slice(preload.indexOf("...(hosted"));
  assert.match(hosted, /shell: \{\s*request:/);
  assert.equal(preload.slice(0, preload.indexOf("...(hosted")).includes("shell:"), false, "shell is exposed outside hosted mode");
  assert.match(preload, /isShellOp\(op\)/, "the preload checks the operation against the fixed list before any IPC");
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.invoke\("(shell:[A-Za-z]+)"/g)].map((m) => m[1]).sort(), ["shell:pickFolder", "shell:request"]);
  for (const forbidden of ["TIMELY_SHELL_TOKEN", "getShellToken", "X-Timely-Shell-Token", "SHELL_TOKEN", "process.env"]) {
    assert.equal(preload.includes(forbidden), false, `preload mentions ${forbidden}`);
  }
  // The renderer's types hold no token either.
  assert.equal(/token/i.test(read("electron-env.d.ts")), false);
});

test("main process keeps the shell token to itself", () => {
  const main = read("electron/main.ts");
  const uses = [...main.matchAll(/getShellToken\(\)/g)].length;
  assert.equal(uses, 1, "the token is read in exactly one place");
  const handler = main.slice(main.indexOf('ipcMain.handle("shell:request"'));
  assert.ok(handler.indexOf("getShellToken()") > 0 && handler.indexOf("getShellToken()") < handler.indexOf("ipcMain.handle(\"shell:pickFolder\""), "only the shell:request handler uses the token");
  // Both handlers check the window and its origin first.
  assert.equal([...main.matchAll(/!fromRendererOrigin\(event\)/g)].length, 2);
  // Nothing the main process sends to a window mentions the token.
  for (const send of main.matchAll(/\.send\(([^)]*)\)/g)) assert.equal(/token/i.test(send[1]), false, send[0]);
  const supervisor = read("electron/supervisor/index.ts");
  assert.equal([...supervisor.matchAll(/this\.shellToken/g)].length, 2, "token: returned by getShellToken and passed to the API env");
});
