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
