// The web app rides through a desktop server restart: requests that are safe
// to send twice are retried while the server is gone (apps/web/app/utils/api/retry.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { hitRestartGap, isRepeatable, withRestartRetry } from "../apps/web/app/utils/api/retry.ts";

const noWait = { delays: [1, 1, 1], sleep: async () => {} };

test("only requests that do the same thing twice are repeatable", () => {
  assert.equal(isRepeatable({}), true);
  assert.equal(isRepeatable({ method: "put", body: "{}" }), true);
  assert.equal(isRepeatable({ method: "DELETE" }), true);
  assert.equal(isRepeatable({ method: "POST", body: "{}" }), false, "creating things");
  assert.equal(isRepeatable({ method: "PATCH", body: "{}" }), false, "sending a chat message is a PATCH");
  assert.equal(isRepeatable({ method: "PUT", body: new ReadableStream() }), false, "a stream body cannot be sent again");
  assert.equal(isRepeatable({ signal: AbortSignal.abort() }), false);
});

test("the gap is a network error or the proxy's 502, not an abort or an API error", () => {
  assert.equal(hitRestartGap({ error: new TypeError("Failed to fetch") }), true);
  assert.equal(hitRestartGap({ response: { status: 502 } }), true);
  assert.equal(hitRestartGap({ error: new DOMException("aborted", "AbortError") }), false);
  assert.equal(hitRestartGap({ response: { status: 503 } }), false, "the API sends 503 itself");
  assert.equal(hitRestartGap({ response: { status: 500 } }), false);
  assert.equal(hitRestartGap({ response: { status: 200 } }), false);
});

test("a request that fails while the server restarts is sent again until it gets through", async () => {
  const outcomes = [() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.resolve(new Response("gone", { status: 502 })), () => Promise.resolve(new Response("ok"))];
  let calls = 0;
  const response = await withRestartRetry(() => outcomes[calls++](), noWait);
  assert.equal(calls, 3);
  assert.equal(await response.text(), "ok");
});

test("an answer from the API is returned as is, without retrying", async () => {
  let calls = 0;
  const response = await withRestartRetry(async () => (calls++, new Response("bad", { status: 400 })), noWait);
  assert.equal(calls, 1);
  assert.equal(response.status, 400);
});

test("after the last retry the failure is passed on", async () => {
  let calls = 0;
  await assert.rejects(
    withRestartRetry(() => (calls++, Promise.reject(new TypeError("Failed to fetch"))), noWait),
    TypeError,
  );
  assert.equal(calls, 4);
  calls = 0;
  const response = await withRestartRetry(async () => (calls++, new Response("", { status: 502 })), noWait);
  assert.equal(response.status, 502);
  assert.equal(calls, 4);
});

test("an aborted request stops retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    withRestartRetry(
      () => {
        calls++;
        controller.abort();
        return Promise.reject(new TypeError("Failed to fetch"));
      },
      { ...noWait, signal: controller.signal },
    ),
  );
  assert.equal(calls, 1);
});
