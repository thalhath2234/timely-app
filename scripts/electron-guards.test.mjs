import assert from "node:assert/strict";
import test from "node:test";
import { isOpenableExternally, isSameOrigin } from "../apps/web/electron/origin.ts";

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
