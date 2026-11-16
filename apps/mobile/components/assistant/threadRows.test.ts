// @ts-nocheck node runs this file directly (node:test, .ts import paths); the app's tsconfig has no node types
// A step the Bot's run parked in Needs you shows on the phone's Bot thread.
// Run: node --experimental-strip-types --test apps/mobile/components/assistant/threadRows.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import type { HostRequest } from "@timely/contract/agentChat";
import { parkedStep, threadIsEmpty } from "./threadRows.ts";

const request = { requestId: "req_1", phase: "parked", card: { kind: "browser", title: "Use the browser" } } as unknown as HostRequest;

test("a thread waiting on a host card shows its parked step", () => {
  assert.equal(parkedStep({ status: "host_approval", hostRequest: request }), request);
});

test("a thread with no waiting card shows no step", () => {
  assert.equal(parkedStep(undefined), undefined);
  assert.equal(parkedStep({ status: "idle", hostRequest: request }), undefined);
  assert.equal(parkedStep({ status: "host_approval", hostRequest: {} as HostRequest }), undefined);
  assert.equal(parkedStep({ status: "host_approval" }), undefined);
});

test("'Nothing yet' is hidden while a step is parked, and shown for a really empty thread", () => {
  assert.equal(threadIsEmpty(0, request, false), false);
  assert.equal(threadIsEmpty(0, undefined, false), true);
  assert.equal(threadIsEmpty(2, undefined, false), false);
  assert.equal(threadIsEmpty(0, undefined, true), false);
});
