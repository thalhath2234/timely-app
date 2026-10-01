import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { beforeEach } from "node:test";
import { createQueryClient } from "../apps/mobile/lib/queryClient.ts";
import {
  configureOfflineQueueStorage,
  enqueueMutation,
  queuedMutationCount,
  queuedMutationsForActiveUser,
  replayQueuedMutations,
  setOfflineQueueUser,
  subscribeQueuedMutations,
} from "../apps/mobile/lib/offlineQueueCore.ts";

// QA-02 regression coverage at the production seams: the app's QueryClient
// configuration (lib/queryClient.ts) and the durable queue policy
// (lib/offlineQueueCore.ts). Only the file storage is replaced with memory.
// Load the same ES module instance that lib/queryClient.ts imports; the
// CommonJS build would carry a separate onlineManager and never pause anything.
const requireMobile = createRequire(
  new URL("../apps/mobile/package.json", import.meta.url),
);
const reactQueryDir = dirname(requireMobile.resolve("@tanstack/react-query/package.json"));
const reactQueryEntry = requireMobile("@tanstack/react-query/package.json").exports["."].import.default;
const { MutationObserver, onlineManager } = await import(
  pathToFileURL(join(reactQueryDir, reactQueryEntry)).href
);

function memoryStorage(initial = null) {
  let text = initial;
  return {
    read: () => text,
    write: (next) => {
      text = next;
    },
    dump: () => text,
  };
}

beforeEach(() => {
  configureOfflineQueueStorage(memoryStorage());
  setOfflineQueueUser(null);
  onlineManager.setOnline(true);
});

test("an offline mutation reaches the durable queue instead of pausing in memory", async () => {
  const client = createQueryClient();
  setOfflineQueueUser("user-a");
  onlineManager.setOnline(false);
  try {
    // Mirrors lib/api/client.ts: the mutation function is what enqueues the
    // change, so it must run even while TanStack Query considers us offline.
    const observer = new MutationObserver(client, {
      mutationFn: async (data) => {
        enqueueMutation("/tasks/task-1", "PUT", data);
        return { queued: true };
      },
    });
    const pending = observer.mutate({ completedAt: "" });
    pending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A paused mutation would sit here forever and vanish with the process.
    assert.equal(observer.getCurrentResult().isPaused, false, "mutation must not pause offline");
    assert.equal(queuedMutationCount(), 1, "the change must be in the durable queue");
    assert.deepEqual(await pending, { queued: true });
    assert.equal(observer.getCurrentResult().status, "success");
    assert.equal(client.getMutationCache().getAll().length, 1);
  } finally {
    onlineManager.setOnline(true);
    client.clear();
  }
});

test("the queue survives a restart and stays scoped to the account that made it", async () => {
  const disk = memoryStorage();
  configureOfflineQueueStorage(disk);
  setOfflineQueueUser("user-a");
  enqueueMutation("/tasks/task-1", "PUT", { completedAt: "" });
  enqueueMutation("/tasks/task-2/today-focus", "PUT", { date: "2026-10-01" });
  assert.equal(queuedMutationCount(), 2);

  // Process killed: module state is gone, the file remains.
  const restarted = memoryStorage(disk.dump());
  configureOfflineQueueStorage(restarted);
  setOfflineQueueUser(null);
  assert.equal(queuedMutationCount(), 0, "no account loaded yet");

  const counts = [];
  const unsubscribe = subscribeQueuedMutations((count) => counts.push(count));

  setOfflineQueueUser("user-b");
  assert.equal(queuedMutationCount(), 0, "another account must not see the queue");
  const sentForB = [];
  const asB = await replayQueuedMutations(async (item) => sentForB.push(item.path), () => false);
  assert.deepEqual(sentForB, []);
  assert.deepEqual(asB, { sent: 0, dropped: 0, remaining: 0 });
  assert.equal(JSON.parse(restarted.dump()).length, 2, "user-a's changes stay on disk");

  setOfflineQueueUser("user-a");
  assert.equal(queuedMutationCount(), 2, "the original account gets its changes back");
  const sentForA = [];
  const asA = await replayQueuedMutations(async (item) => sentForA.push(item.path), () => false);
  assert.deepEqual(sentForA, ["/tasks/task-1", "/tasks/task-2/today-focus"]);
  assert.deepEqual(asA, { sent: 2, dropped: 0, remaining: 0 });
  assert.equal(JSON.parse(restarted.dump()).length, 0);
  unsubscribe();
  assert.deepEqual(counts, [0, 0, 2, 1, 0], "subscribers see account switches and replay progress");
});

test("replay drops a rejected change and keeps the rest after a network failure", async () => {
  setOfflineQueueUser("user-a");
  enqueueMutation("/tasks/ok", "PUT", { completedAt: "" });
  enqueueMutation("/tasks/gone", "PUT", { completedAt: "" });
  enqueueMutation("/tasks/later", "PUT", { completedAt: "" });

  const sent = [];
  const outcome = await replayQueuedMutations(
    async (item) => {
      sent.push(item.path);
      if (item.path === "/tasks/gone") throw Object.assign(new Error("Not found"), { status: 404 });
      if (item.path === "/tasks/later") throw new TypeError("Network request failed");
    },
    (error) => typeof error?.status === "number" && error.status >= 400 && error.status < 500,
  );
  assert.deepEqual(sent, ["/tasks/ok", "/tasks/gone", "/tasks/later"]);
  assert.deepEqual(outcome, { sent: 1, dropped: 1, remaining: 1 });
  assert.deepEqual(
    queuedMutationsForActiveUser().map((item) => item.path),
    ["/tasks/later"],
    "the change that hit a network failure waits for the next replay",
  );
});

test("a change cannot be queued before the account is known", () => {
  assert.throws(() => enqueueMutation("/tasks/task-1", "PUT", {}), /account is loaded/);
  assert.equal(queuedMutationCount(), 0);
});
