import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createAutosaveQueue, isRejection, refusalMessage } from "../packages/contract/src/autosaveQueue.ts";

const refused = (message) => Object.assign(new Error(message), { status: 400 });
const offline = () => new TypeError("Failed to fetch");

/** A save that refuses any patch holding a blockedById of "gone", like PUT /tasks/:id. */
function server() {
  const sent = [];
  const saved = {};
  const save = async (patch) => {
    sent.push(patch);
    if (patch.blockedById === "gone") throw refused("blocking task not found");
    Object.assign(saved, patch);
  };
  return { sent, saved, save };
}

describe("autosave queue", () => {
  test("a refused change is dropped, so the next edit saves on its own", async () => {
    const queue = createAutosaveQueue();
    const { sent, saved, save } = server();
    const outcomes = [];
    queue.add({ blockedById: "gone" }, (outcome) => outcomes.push(outcome));
    const first = await queue.send(save);
    assert.equal(first.ok, false);
    assert.equal(first.rejected.message, "blocking task not found");
    assert.equal(queue.pending(), false);
    assert.deepEqual(outcomes, ["rejected"]);

    queue.add({ name: "Ship release notes v2" });
    const second = await queue.send(save);
    assert.deepEqual(second, { ok: true });
    assert.deepEqual(sent.at(-1), { name: "Ship release notes v2" });
    assert.equal(saved.name, "Ship release notes v2");
  });

  test("a refused request with several edits saves the good ones and drops only the refused one", async () => {
    const queue = createAutosaveQueue();
    const { sent, saved, save } = server();
    const refusedPatches = [];
    const outcomes = {};
    queue.add({ name: "Renamed" }, (outcome) => (outcomes.name = outcome));
    queue.add({ blockedById: "gone" }, (outcome) => (outcomes.blocker = outcome));
    queue.add({ priorityLevel: "high" }, (outcome) => (outcomes.priority = outcome));
    const result = await queue.send(save, (_error, patch) => refusedPatches.push(patch));
    assert.equal(result.ok, false);
    assert.deepEqual(sent[0], { name: "Renamed", blockedById: "gone", priorityLevel: "high" });
    assert.deepEqual(saved, { name: "Renamed", priorityLevel: "high" });
    assert.deepEqual(refusedPatches, [{ blockedById: "gone" }]);
    assert.deepEqual(outcomes, { name: "saved", blocker: "rejected", priority: "saved" });
    assert.equal(queue.pending(), false);
  });

  test("a write that fails on the way keeps its edits for the retry", async () => {
    const queue = createAutosaveQueue();
    let online = false;
    const sent = [];
    const save = async (patch) => {
      sent.push(patch);
      if (!online) throw offline();
    };
    const outcomes = [];
    queue.add({ name: "A" }, (outcome) => outcomes.push(outcome));
    const failed = await queue.send(save);
    assert.equal(failed.ok, false);
    assert.ok(failed.error instanceof TypeError);
    assert.equal(queue.pending(), true);
    queue.add({ priorityLevel: "low" });
    online = true;
    assert.deepEqual(await queue.send(save), { ok: true });
    assert.deepEqual(sent.at(-1), { name: "A", priorityLevel: "low" });
    assert.deepEqual(outcomes, ["failed"]);
  });

  test("typing in one field stays one edit, the latest value winning", async () => {
    const queue = createAutosaveQueue();
    const { sent, save } = server();
    for (const name of ["S", "Sh", "Shi", "Ship"]) queue.add({ name });
    await queue.send(save);
    assert.deepEqual(sent, [{ name: "Ship" }]);
  });

  test("edits queued while a write runs go out next, in order", async () => {
    const queue = createAutosaveQueue();
    const sent = [];
    const save = async (patch) => {
      sent.push(patch);
      if (sent.length === 1) queue.add({ name: "later" });
    };
    queue.add({ name: "first" });
    assert.deepEqual(await queue.send(save), { ok: true });
    assert.deepEqual(sent, [{ name: "first" }, { name: "later" }]);
  });

  test("only refusals of the change itself count, not sign-in or server trouble", () => {
    for (const status of [400, 404, 409, 413, 422]) assert.equal(isRejection({ status }), true, String(status));
    for (const status of [401, 403, 408, 429, 500, 503]) assert.equal(isRejection({ status }), false, String(status));
    assert.equal(isRejection(new Error("Failed to fetch")), false);
    assert.equal(isRejection(undefined), false);
  });

  test("the refusal note says the change was not saved, then why", () => {
    assert.equal(refusalMessage(refused("blocking task not found")), "Couldn’t save that change. Blocking task not found.");
    assert.equal(refusalMessage(refused("Name is too long.")), "Couldn’t save that change. Name is too long.");
    assert.equal(refusalMessage({}), "Couldn’t save that change.");
  });
});
